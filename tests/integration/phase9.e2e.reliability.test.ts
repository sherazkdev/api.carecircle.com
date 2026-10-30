import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadEnv, resetEnvCache } from '../../src/config/env.js';
import { Circle } from '../../src/modules/circle/circle.model.js';
import { Device } from '../../src/modules/device/device.model.js';
import { Member } from '../../src/modules/member/member.model.js';
import { configureDeliveryPort } from '../../src/modules/notification/configureDelivery.js';
import {
  DeliveryAttempt,
  hashFcmToken,
} from '../../src/modules/notification/deliveryAttempt.model.js';
import { FcmDeliveryPort } from '../../src/modules/notification/fcmDelivery.js';
import type { FcmBatchResult, FcmClient } from '../../src/modules/notification/fcmClient.js';
import {
  FakeClock,
  RecordingDeliveryPort,
  claimNextJob,
  processClaimedJob,
  resetClock,
  resetDeliveryPort,
  setClock,
  setDeliveryPort,
} from '../../src/scheduler/index.js';
import { Job } from '../../src/scheduler/job.model.js';
import { SchedulerWorker } from '../../src/scheduler/worker.js';
import { installAuthMock, uninstallAuthMock } from '../helpers/authMock.js';
import { applyTestEnv } from '../helpers/setupEnv.js';
import { clearAllCollections, startTestMongo, stopTestMongo } from '../helpers/mongoTest.js';

const medBody = {
  title: 'Paracetamol',
  scheduleMode: 'daily' as const,
  times: ['08:00'],
  startDate: '2026-03-01',
  reminderEnabled: true,
  notifyFamilyOnMiss: true,
  leadTimeMinutes: 5 as const,
  snoozeMinutes: 0 as const,
  reminderTone: 'gentle_chime',
};

async function seed() {
  await Circle.create({ circleId: 'circle-1', ownerUid: 'owner-1', timezone: 'Asia/Karachi' });
  await Member.create({
    circleId: 'circle-1',
    uid: 'owner-1',
    role: 'owner',
    displayName: 'Owner',
    prefs: { medication: true, appointment: true, task: true, updates: true },
  });
  await Member.create({
    circleId: 'circle-1',
    uid: 'member-1',
    role: 'member',
    displayName: 'Family',
    prefs: { medication: true, appointment: true, task: true, updates: true },
  });
  await Device.create({
    circleId: 'circle-1',
    uid: 'owner-1',
    fcmToken: 'owner-tok',
    platform: 'android',
  });
  await Device.create({
    circleId: 'circle-1',
    uid: 'member-1',
    fcmToken: 'member-tok',
    platform: 'android',
  });
}

describe('Phase 9 E2E integration and reliability', () => {
  let app: ReturnType<typeof createApp>;
  let delivery: RecordingDeliveryPort;
  let clock: FakeClock;

  beforeAll(async () => {
    applyTestEnv();
    await startTestMongo();
    installAuthMock();
    app = createApp();
  }, 120_000);

  afterAll(async () => {
    uninstallAuthMock();
    await stopTestMongo();
    resetClock();
    resetDeliveryPort();
  });

  beforeEach(async () => {
    applyTestEnv();
    await clearAllCollections();
    clock = new FakeClock('2026-03-10T02:00:00.000Z');
    setClock(clock);
    delivery = new RecordingDeliveryPort();
    setDeliveryPort(delivery);
    await seed();
  });

  it('HTTP reminder → jobs → claim → eligibility → template path → delivery → sent', async () => {
    const create = await request(app)
      .put('/v1/circles/circle-1/reminders/medication/med-e2e')
      .set('Authorization', 'Bearer user:owner-1')
      .send(medBody);
    expect(create.status).toBe(200);
    expect(create.body.data.jobsPlanned).toBeGreaterThan(0);

    const pending = await Job.countDocuments({ itemId: 'med-e2e', state: 'pending' });
    expect(pending).toBeGreaterThanOrEqual(3); // before/due/missed

    clock.set('2026-03-10T03:00:00.000Z');
    setClock(clock);

    let processed = 0;
    for (let i = 0; i < 10; i++) {
      const job = await claimNextJob(`e2e-${i}`);
      if (!job) break;
      await processClaimedJob(job);
      processed += 1;
    }
    expect(processed).toBeGreaterThan(0);
    expect(delivery.requests.length).toBeGreaterThan(0);
    expect(delivery.requests.every((r) => r.recipients.every((x) => x.fcmToken))).toBe(true);
    // FCM accept ≠ device display: RecordingDeliveryPort only simulates FCM acceptance.
    expect(await Job.countDocuments({ itemId: 'med-e2e', state: 'sent' })).toBeGreaterThan(0);
  });

  it('applies preference change immediately before delivery', async () => {
    await request(app)
      .put('/v1/circles/circle-1/reminders/medication/med-pref')
      .set('Authorization', 'Bearer user:owner-1')
      .send({ ...medBody, reminderEnabled: false, notifyFamilyOnMiss: true });

    await request(app)
      .put('/v1/circles/circle-1/members/me/prefs')
      .set('Authorization', 'Bearer user:member-1')
      .send({ medication: false, appointment: true, task: true, updates: true });

    clock.set('2026-03-10T03:00:00.000Z');
    setClock(clock);
    delivery.reset();

    for (let i = 0; i < 10; i++) {
      const job = await claimNextJob(`pref-${i}`);
      if (!job) break;
      await processClaimedJob(job);
    }

    expect(delivery.requests.filter((r) => r.type === 'med_due')).toHaveLength(0);
    expect(delivery.requests.filter((r) => r.type === 'med_missed')).toHaveLength(0);
  });

  it('rejects unauthenticated update and circle delete', async () => {
    expect(
      (
        await request(app)
          .post('/v1/circles/circle-1/updates')
          .send({ updateType: 'health', notes: 'x' })
      ).status,
    ).toBe(401);
    expect((await request(app).delete('/v1/circles/circle-1')).status).toBe(401);
    expect((await request(app).delete('/v1/members/me')).status).toBe(401);
  });

  it('worker graceful stop waits for in-flight tick without claiming new batches', async () => {
    await request(app)
      .put('/v1/circles/circle-1/reminders/medication/med-stop')
      .set('Authorization', 'Bearer user:owner-1')
      .send(medBody);
    clock.set('2026-03-10T03:00:00.000Z');
    setClock(clock);

    const worker = new SchedulerWorker({ workerId: 'stop-w', pollIntervalMs: 60_000, batchSize: 50 });
    // Manual tick without start() — start() would race an overlapping tick.
    const n = await worker.tick();
    expect(n).toBeGreaterThan(0);
    await worker.stop();
    const again = await worker.tick();
    expect(again).toBe(0);
  });

  it('enforces delivery_attempt uniqueness and FCM partial ledger path', async () => {
    const mock: FcmClient = {
      async sendEach(messages): Promise<FcmBatchResult> {
        return {
          successCount: messages.length,
          failureCount: 0,
          responses: messages.map((_, i) => ({ success: true, messageId: `m${i}` })),
        };
      },
    };
    const port = new FcmDeliveryPort({ client: mock });
    setDeliveryPort(port);

    const result = await port.deliver({
      jobId: 'ledger-job-1',
      circleId: 'circle-1',
      itemId: 'med-1',
      module: 'medication',
      type: 'med_due',
      occurrenceKey: '2026-3-10-8-0',
      scheduledAtIso: '2026-03-10T08:00:00+05:00',
      audience: 'owner',
      timezone: 'Asia/Karachi',
      titleHint: 'Paracetamol',
      recipients: [
        { uid: 'owner-1', fcmToken: 'owner-tok', platform: 'android' },
        { uid: 'owner-1', fcmToken: 'owner-tok', platform: 'android' },
      ],
    });
    expect(result).toEqual({ ok: true, pushed: true });
    expect(await DeliveryAttempt.countDocuments({ jobId: 'ledger-job-1', status: 'sent' })).toBe(1);

    await expect(
      DeliveryAttempt.create({
        jobId: 'ledger-job-1',
        circleId: 'circle-1',
        tokenHash: hashFcmToken('owner-tok'),
        uid: 'owner-1',
        status: 'sent',
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('rejects invalid environment configuration', () => {
    resetEnvCache();
    expect(() =>
      loadEnv({
        NODE_ENV: 'test',
        MONGODB_URI: '',
        FIREBASE_PROJECT_ID: 'x',
        FIREBASE_SERVICE_ACCOUNT_PATH: './x.json',
      } as NodeJS.ProcessEnv),
    ).toThrow(/MONGODB_URI|Invalid environment/i);
    applyTestEnv();
  });

  it('forbids production noop delivery for workers (silent discard prevention)', () => {
    applyTestEnv({ DELIVERY_MODE: 'noop', NODE_ENV: 'production', PROCESS_MODE: 'worker' });
    expect(() => configureDeliveryPort()).toThrow(/forbidden/i);
    applyTestEnv();
    resetDeliveryPort();
  });

  it('supports multi-circle isolation across concurrent reminder upserts', async () => {
    await Circle.create({ circleId: 'circle-2', ownerUid: 'owner-1', timezone: 'UTC' });
    await Member.create({
      circleId: 'circle-2',
      uid: 'owner-1',
      role: 'owner',
      displayName: 'Owner',
      prefs: { medication: true, appointment: true, task: true, updates: true },
    });

    const [a, b] = await Promise.all([
      request(app)
        .put('/v1/circles/circle-1/reminders/medication/shared-id')
        .set('Authorization', 'Bearer user:owner-1')
        .send(medBody),
      request(app)
        .put('/v1/circles/circle-2/reminders/medication/shared-id')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ ...medBody, times: ['12:00'], startDate: '2026-06-01' }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await Job.countDocuments({ circleId: 'circle-1', itemId: 'shared-id' })).toBeGreaterThan(
      0,
    );
    expect(await Job.countDocuments({ circleId: 'circle-2', itemId: 'shared-id' })).toBeGreaterThan(
      0,
    );
  });

  it('documents C2 bootstrap remains gated without trusted issuer', async () => {
    applyTestEnv({ CIRCLE_BOOTSTRAP_ENABLED: 'false' });
    const res = await request(app)
      .post('/v1/circles/brand-new/devices')
      .set('Authorization', 'Bearer user:newbie')
      .send({
        fcmToken: 'tok-new',
        platform: 'android',
        displayName: 'Newbie',
        role: 'owner',
        timezone: 'UTC',
        ownershipProof: 'not-a-real-token',
      });
    // Fail-closed: bootstrap disabled → 503 (or 400 if proof validated first — must not create circle)
    expect([400, 503]).toContain(res.status);
    expect(await Circle.findOne({ circleId: 'brand-new' })).toBeNull();
    applyTestEnv();
  });
});
