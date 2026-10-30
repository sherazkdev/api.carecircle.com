import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { Circle } from '../../src/modules/circle/circle.model.js';
import { Completion } from '../../src/modules/completion/completion.model.js';
import { Device } from '../../src/modules/device/device.model.js';
import { Member } from '../../src/modules/member/member.model.js';
import { DeliveryAttempt, hashFcmToken } from '../../src/modules/notification/deliveryAttempt.model.js';
import { ReminderItem } from '../../src/modules/reminder/reminderItem.model.js';
import { UpdateOutbox } from '../../src/modules/update/updateOutbox.model.js';
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
import { upsertReminder } from '../../src/modules/reminder/reminder.service.js';
import { installAuthMock, uninstallAuthMock } from '../helpers/authMock.js';
import { applyTestEnv } from '../helpers/setupEnv.js';
import { clearAllCollections, startTestMongo, stopTestMongo } from '../helpers/mongoTest.js';

async function seedCircle(circleId = 'circle-1') {
  await Circle.create({ circleId, ownerUid: 'owner-1', timezone: 'Asia/Karachi' });
  await Member.create({
    circleId,
    uid: 'owner-1',
    role: 'owner',
    displayName: 'Owner One',
    prefs: { medication: true, appointment: true, task: true, updates: true },
  });
  await Member.create({
    circleId,
    uid: 'member-1',
    role: 'member',
    displayName: 'Sara Miller',
    prefs: { medication: true, appointment: true, task: true, updates: true },
  });
  await Member.create({
    circleId,
    uid: 'member-2',
    role: 'member',
    displayName: 'Bob',
    prefs: { medication: true, appointment: true, task: true, updates: true },
  });
  await Device.create({
    circleId,
    uid: 'owner-1',
    fcmToken: 'owner-tok-a',
    platform: 'android',
  });
  await Device.create({
    circleId,
    uid: 'owner-1',
    fcmToken: 'owner-tok-b',
    platform: 'android',
  });
  await Device.create({
    circleId,
    uid: 'member-1',
    fcmToken: 'member-tok',
    platform: 'android',
  });
  await Device.create({
    circleId,
    uid: 'member-2',
    fcmToken: 'member2-tok',
    platform: 'android',
  });
}

describe('Phase 8 updates and deletion', () => {
  let app: ReturnType<typeof createApp>;
  let delivery: RecordingDeliveryPort;

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
    delivery = new RecordingDeliveryPort();
    setDeliveryPort(delivery);
    await seedCircle();
  });

  describe('POST /v1/circles/:circleId/updates', () => {
    it('allows owner and member to share updates', async () => {
      const ownerRes = await request(app)
        .post('/v1/circles/circle-1/updates')
        .set('Authorization', 'Bearer user:owner-1')
        .set('Idempotency-Key', 'upd-owner-1')
        .send({ updateType: 'health', senderName: 'Ignored', notes: 'Owner note' });
      expect(ownerRes.status).toBe(200);
      expect(ownerRes.body.data.senderDisplayName).toBe('Owner One');
      expect(ownerRes.body.data.delivery.pushed).toBe(true);
      expect(delivery.requests[0]?.recipients.map((r) => r.uid).sort()).toEqual([
        'member-1',
        'member-2',
      ]);

      delivery.reset();
      const memberRes = await request(app)
        .post('/v1/circles/circle-1/updates')
        .set('Authorization', 'Bearer user:member-1')
        .set('Idempotency-Key', 'upd-member-1')
        .send({ updateType: 'health', senderName: 'Fake Name', notes: 'Member note' });
      expect(memberRes.status).toBe(200);
      expect(memberRes.body.data.senderDisplayName).toBe('Sara Miller');
      const uids = delivery.requests[0]?.recipients.map((r) => r.uid) ?? [];
      expect(uids).toContain('owner-1');
      expect(uids).not.toContain('member-1');
    });

    it('rejects non-members and spoofed senderName identity', async () => {
      const denied = await request(app)
        .post('/v1/circles/circle-1/updates')
        .set('Authorization', 'Bearer user:stranger')
        .send({ updateType: 'health', senderName: 'Hacker', notes: 'nope' });
      expect(denied.status).toBe(403);

      const spoof = await request(app)
        .post('/v1/circles/circle-1/updates')
        .set('Authorization', 'Bearer user:member-1')
        .set('Idempotency-Key', 'spoof-1')
        .send({ updateType: 'health', senderName: 'Not Sara', notes: 'hi' });
      expect(spoof.body.data.senderDisplayName).toBe('Sara Miller');
      expect(spoof.body.data.senderDisplayName).not.toBe('Not Sara');
    });

    it('respects updates pref and multi-device delivery with token dedupe', async () => {
      await Member.updateOne(
        { circleId: 'circle-1', uid: 'member-2' },
        { $set: { 'prefs.updates': false } },
      );
      // Duplicate token registration attempt shouldn't create duplicate recipients
      await Device.create({
        circleId: 'circle-1',
        uid: 'owner-1',
        fcmToken: 'owner-tok-a',
        platform: 'android',
      }).catch(() => undefined);

      const res = await request(app)
        .post('/v1/circles/circle-1/updates')
        .set('Authorization', 'Bearer user:member-1')
        .set('Idempotency-Key', 'pref-1')
        .send({ updateType: 'health', notes: 'Hello' });
      expect(res.status).toBe(200);
      const tokens = delivery.requests[0]?.recipients.map((r) => r.fcmToken) ?? [];
      expect(tokens).toContain('owner-tok-a');
      expect(tokens).toContain('owner-tok-b');
      expect(tokens).not.toContain('member2-tok');
      expect(new Set(tokens).size).toBe(tokens.length);
    });

    it('handles idempotent retries and temporary FCM failure without duplicate events', async () => {
      delivery.nextResult = { ok: false, temporary: true, message: 'fcm down' };
      const first = await request(app)
        .post('/v1/circles/circle-1/updates')
        .set('Authorization', 'Bearer user:owner-1')
        .set('Idempotency-Key', 'retry-key-1')
        .send({ updateType: 'health', notes: 'Retry me' });
      expect(first.status).toBe(200);
      expect(first.body.data.delivery.pushed).toBe(false);
      expect(first.body.data.delivery.status).toBe('failed_temp');
      expect(await UpdateOutbox.countDocuments({ idempotencyKey: 'retry-key-1' })).toBe(1);

      delivery.nextResult = { ok: true, pushed: true };
      delivery.reset();
      const second = await request(app)
        .post('/v1/circles/circle-1/updates')
        .set('Authorization', 'Bearer user:owner-1')
        .set('Idempotency-Key', 'retry-key-1')
        .send({ updateType: 'health', notes: 'Retry me' });
      expect(second.body.data.updateId).toBe(first.body.data.updateId);
      expect(second.body.data.delivery.pushed).toBe(true);
      expect(second.body.data.replayed).toBe(true);

      delivery.reset();
      const third = await request(app)
        .post('/v1/circles/circle-1/updates')
        .set('Authorization', 'Bearer user:owner-1')
        .set('Idempotency-Key', 'retry-key-1')
        .send({ updateType: 'health', notes: 'Retry me' });
      expect(third.body.data.replayed).toBe(true);
      expect(delivery.requests).toHaveLength(0);
      expect(await UpdateOutbox.countDocuments({ circleId: 'circle-1' })).toBe(1);
    });
  });

  describe('member leave / account delete / owner remove', () => {
    it('member leaves a circle', async () => {
      const res = await request(app)
        .delete('/v1/members/me')
        .query({ circleId: 'circle-1' })
        .set('Authorization', 'Bearer user:member-1');
      expect(res.status).toBe(200);
      expect(res.body.data.removed ?? res.body.data.totals.members).toBeTruthy();
      expect(await Member.findOne({ uid: 'member-1', circleId: 'circle-1' })).toBeNull();
      expect(await Device.countDocuments({ uid: 'member-1', circleId: 'circle-1' })).toBe(0);
      expect(await Member.findOne({ uid: 'owner-1' })).not.toBeNull();
    });

    it('member deletes own account data from all memberships', async () => {
      await Circle.create({ circleId: 'circle-x', ownerUid: 'owner-x', timezone: 'UTC' });
      await Member.create({
        circleId: 'circle-x',
        uid: 'owner-x',
        role: 'owner',
        displayName: 'OX',
        prefs: { medication: true, appointment: true, task: true, updates: true },
      });
      await Member.create({
        circleId: 'circle-x',
        uid: 'member-1',
        role: 'member',
        displayName: 'Sara',
        prefs: { medication: true, appointment: true, task: true, updates: true },
      });
      await Device.create({
        circleId: 'circle-x',
        uid: 'member-1',
        fcmToken: 'm1-x',
        platform: 'android',
      });

      const res = await request(app)
        .delete('/v1/members/me')
        .set('Authorization', 'Bearer user:member-1');
      expect(res.status).toBe(200);
      expect(res.body.data.mode).toBe('all');
      expect(await Member.countDocuments({ uid: 'member-1' })).toBe(0);
      expect(await Device.countDocuments({ uid: 'member-1' })).toBe(0);
      expect(await Circle.findOne({ circleId: 'circle-1' })).not.toBeNull();
    });

    it('owner account delete returns 409 (C4) before any cleanup', async () => {
      const beforeMembers = await Member.countDocuments({ uid: 'owner-1' });
      const res = await request(app)
        .delete('/v1/members/me')
        .set('Authorization', 'Bearer user:owner-1');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(await Member.countDocuments({ uid: 'owner-1' })).toBe(beforeMembers);
      expect(await Device.countDocuments({ uid: 'owner-1' })).toBeGreaterThan(0);
    });

    it('owner removes member; non-owner and cross-circle denied', async () => {
      const ok = await request(app)
        .delete('/v1/members/member-1')
        .query({ circleId: 'circle-1' })
        .set('Authorization', 'Bearer user:owner-1');
      expect(ok.status).toBe(200);
      expect(ok.body.data.removed).toBe(true);

      const again = await request(app)
        .delete('/v1/members/member-1')
        .query({ circleId: 'circle-1' })
        .set('Authorization', 'Bearer user:owner-1');
      expect(again.status).toBe(200);
      expect(again.body.data.removed).toBe(false);

      await Member.create({
        circleId: 'circle-1',
        uid: 'member-1',
        role: 'member',
        displayName: 'Sara',
        prefs: { medication: true, appointment: true, task: true, updates: true },
      });
      const denied = await request(app)
        .delete('/v1/members/member-2')
        .query({ circleId: 'circle-1' })
        .set('Authorization', 'Bearer user:member-1');
      expect(denied.status).toBe(403);

      await Circle.create({ circleId: 'circle-2', ownerUid: 'owner-2', timezone: 'UTC' });
      await Member.create({
        circleId: 'circle-2',
        uid: 'owner-2',
        role: 'owner',
        displayName: 'O2',
        prefs: { medication: true, appointment: true, task: true, updates: true },
      });
      await Member.create({
        circleId: 'circle-2',
        uid: 'victim',
        role: 'member',
        displayName: 'V',
        prefs: { medication: true, appointment: true, task: true, updates: true },
      });
      const cross = await request(app)
        .delete('/v1/members/victim')
        .query({ circleId: 'circle-2' })
        .set('Authorization', 'Bearer user:owner-1');
      expect(cross.status).toBe(403);
      expect(await Member.findOne({ circleId: 'circle-2', uid: 'victim' })).not.toBeNull();
    });
  });

  describe('circle cascade deletion', () => {
    it('cascades circle data including jobs, completions, delivery attempts, outbox', async () => {
      await upsertReminder({
        circleId: 'circle-1',
        module: 'medication',
        itemId: 'med-1',
        body: {
          title: 'Para',
          scheduleMode: 'daily',
          times: ['08:00'],
          startDate: '2026-03-01',
          reminderEnabled: true,
          notifyFamilyOnMiss: true,
          leadTimeMinutes: 10,
          snoozeMinutes: 0,
          reminderTone: 'gentle_chime',
        },
      });
      await Completion.create({
        circleId: 'circle-1',
        itemId: 'med-1',
        occurrenceKey: '2026-3-10-8-0',
        completed: true,
        updatedBy: 'owner-1',
      });
      await DeliveryAttempt.create({
        jobId: 'job-x',
        circleId: 'circle-1',
        tokenHash: hashFcmToken('owner-tok-a'),
        uid: 'owner-1',
        status: 'sent',
      });
      await UpdateOutbox.create({
        updateId: 'upd-x',
        circleId: 'circle-1',
        senderUid: 'owner-1',
        senderDisplayName: 'Owner One',
        updateType: 'health',
        notes: 'bye',
        idempotencyKey: 'cascade-1',
        deliveryStatus: 'sent',
        recipientDeviceCount: 1,
      });

      const res = await request(app)
        .delete('/v1/circles/circle-1')
        .set('Authorization', 'Bearer user:owner-1');
      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
      expect(typeof res.body.data.transactional).toBe('boolean');
      expect(await Circle.findOne({ circleId: 'circle-1' })).toBeNull();
      expect(await Member.countDocuments({ circleId: 'circle-1' })).toBe(0);
      expect(await Device.countDocuments({ circleId: 'circle-1' })).toBe(0);
      expect(await ReminderItem.countDocuments({ circleId: 'circle-1' })).toBe(0);
      expect(await Completion.countDocuments({ circleId: 'circle-1' })).toBe(0);
      expect(await Job.countDocuments({ circleId: 'circle-1' })).toBe(0);
      expect(await DeliveryAttempt.countDocuments({ circleId: 'circle-1' })).toBe(0);
      expect(await UpdateOutbox.countDocuments({ circleId: 'circle-1' })).toBe(0);

      const again = await request(app)
        .delete('/v1/circles/circle-1')
        .set('Authorization', 'Bearer user:owner-1');
      expect(again.status).toBe(200);
      expect(again.body.data.deleted).toBe(false);
    });

    it('handles concurrent circle deletion safely', async () => {
      const [a, b] = await Promise.all([
        request(app).delete('/v1/circles/circle-1').set('Authorization', 'Bearer user:owner-1'),
        request(app).delete('/v1/circles/circle-1').set('Authorization', 'Bearer user:owner-1'),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect([a.body.data.deleted, b.body.data.deleted].filter(Boolean).length).toBeGreaterThanOrEqual(
        1,
      );
      expect(await Circle.findOne({ circleId: 'circle-1' })).toBeNull();
    });

    it('non-owner cannot delete circle', async () => {
      const res = await request(app)
        .delete('/v1/circles/circle-1')
        .set('Authorization', 'Bearer user:member-1');
      expect(res.status).toBe(403);
      expect(await Circle.findOne({ circleId: 'circle-1' })).not.toBeNull();
    });

    it('scheduler skips jobs after circle deletion (eligibility race)', async () => {
      const clock = new FakeClock('2026-03-10T02:00:00.000Z');
      setClock(clock);
      await upsertReminder({
        circleId: 'circle-1',
        module: 'medication',
        itemId: 'med-race',
        body: {
          title: 'Para',
          scheduleMode: 'daily',
          times: ['08:00'],
          startDate: '2026-03-01',
          reminderEnabled: true,
          notifyFamilyOnMiss: false,
          leadTimeMinutes: 5,
          snoozeMinutes: 0,
          reminderTone: 'gentle_chime',
        },
      });
      clock.set('2026-03-10T03:00:00.000Z');
      setClock(clock);

      const job = await claimNextJob('race-w');
      expect(job).toBeTruthy();

      await request(app)
        .delete('/v1/circles/circle-1')
        .set('Authorization', 'Bearer user:owner-1');

      // If job document was deleted by cascade, process may no-op on missing; re-fetch
      const stillThere = await Job.findById(job!._id);
      if (stillThere) {
        delivery.reset();
        await processClaimedJob(stillThere);
        expect(delivery.requests).toHaveLength(0);
      } else {
        expect(await Job.countDocuments({ circleId: 'circle-1' })).toBe(0);
      }
      resetClock();
    });
  });
});
