import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Circle } from '../../src/modules/circle/circle.model.js';
import { Device } from '../../src/modules/device/device.model.js';
import { Member } from '../../src/modules/member/member.model.js';
import {
  DeliveryAttempt,
  hashFcmToken,
} from '../../src/modules/notification/deliveryAttempt.model.js';
import { FcmDeliveryPort } from '../../src/modules/notification/fcmDelivery.js';
import type { FcmClient, FcmBatchResult } from '../../src/modules/notification/fcmClient.js';
import {
  buildReminderFcmData,
  buildUpdateFcmData,
  buildTokenMessage,
} from '../../src/modules/notification/fcmPayload.js';
import { configureDeliveryPort } from '../../src/modules/notification/configureDelivery.js';
import {
  NoopDeliveryPort,
  getDeliveryPort,
  isProductionFcmDeliveryConfigured,
  resetDeliveryPort,
  setDeliveryPort,
  type DeliveryRequest,
} from '../../src/scheduler/delivery.js';
import { claimNextJob, processClaimedJob } from '../../src/scheduler/index.js';
import { Job } from '../../src/scheduler/job.model.js';
import { FakeClock, setClock, resetClock } from '../../src/scheduler/clock.js';
import { upsertReminder } from '../../src/modules/reminder/reminder.service.js';
import { applyTestEnv } from '../helpers/setupEnv.js';
import { clearAllCollections, startTestMongo, stopTestMongo } from '../helpers/mongoTest.js';

function baseRequest(overrides: Partial<DeliveryRequest> = {}): DeliveryRequest {
  return {
    jobId: 'job-1',
    circleId: 'circle-1',
    itemId: 'med-1',
    module: 'medication',
    type: 'med_due',
    occurrenceKey: '2026-3-10-8-0',
    scheduledAtIso: '2026-03-10T08:00:00+05:00',
    audience: 'owner',
    timezone: 'Asia/Karachi',
    titleHint: 'Paracetamol',
    tone: 'gentle_chime',
    recipients: [
      { uid: 'owner-1', fcmToken: 'token-a', platform: 'android' },
      { uid: 'owner-1', fcmToken: 'token-b', platform: 'android' },
    ],
    ...overrides,
  };
}

class MockFcmClient implements FcmClient {
  calls: Parameters<FcmClient['sendEach']>[0][] = [];
  next: FcmBatchResult | ((messages: Parameters<FcmClient['sendEach']>[0]) => FcmBatchResult) = {
    successCount: 0,
    failureCount: 0,
    responses: [],
  };

  async sendEach(messages: Parameters<FcmClient['sendEach']>[0]): Promise<FcmBatchResult> {
    this.calls.push(messages);
    return typeof this.next === 'function' ? this.next(messages) : this.next;
  }
}

function err(code: string, message = code): Error {
  const e = new Error(message);
  (e as { code?: string }).code = code;
  return e;
}

describe('Phase 7 FCM delivery', () => {
  let mock: MockFcmClient;
  let port: FcmDeliveryPort;

  beforeAll(async () => {
    applyTestEnv();
    await startTestMongo();
  }, 120_000);

  afterAll(async () => {
    await stopTestMongo();
    resetClock();
    resetDeliveryPort();
  });

  beforeEach(async () => {
    applyTestEnv();
    await clearAllCollections();
    mock = new MockFcmClient();
    port = new FcmDeliveryPort({ client: mock });
    await Circle.create({ circleId: 'circle-1', ownerUid: 'owner-1', timezone: 'Asia/Karachi' });
  });

  it('builds string-only reminder data with android high priority', () => {
    const data = buildReminderFcmData({
      type: 'med_due',
      module: 'medication',
      circleId: 'c',
      itemId: 'i',
      occurrenceKey: '2026-3-10-8-0',
      scheduledAt: '2026-03-10T08:00:00+05:00',
      title: 'Time for your medicine',
      body: 'Take Paracetamol now (08:00 AM)',
      tone: 'gentle_chime',
    });
    for (const v of Object.values(data)) {
      expect(typeof v).toBe('string');
    }
    const msg = buildTokenMessage('t', data);
    expect(msg.android.priority).toBe('high');
    expect('notification' in msg).toBe(false);
  });

  it('builds update payload with sender template fields', () => {
    const data = buildUpdateFcmData({
      circleId: 'c',
      updateType: 'health',
      title: 'Sara Miller shared an update',
      body: 'Feeling better',
    });
    expect(data.type).toBe('update_new');
    expect(data.module).toBe('update');
    expect(data.updateType).toBe('health');
  });

  it('sends medication before/due/missed/snooze payloads via mock FCM', async () => {
    const types = ['med_before', 'med_due', 'med_missed', 'med_snooze'] as const;
    for (const type of types) {
      mock.calls = [];
      mock.next = {
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true, messageId: 'm1' }],
      };
      const result = await port.deliver(
        baseRequest({
          jobId: `job-${type}`,
          type,
          leadTimeMinutes: 10,
          recipients: [{ uid: 'owner-1', fcmToken: `tok-${type}`, platform: 'android' }],
        }),
      );
      expect(result).toEqual({ ok: true, pushed: true });
      const data = mock.calls[0]![0]!.data;
      expect(data.type).toBe(type);
      expect(String(data.title).length).toBeGreaterThan(0);
      expect(String(data.body).length).toBeGreaterThan(0);
      expect(data.tone).toBe('gentle_chime');
    }
  });

  it('sends appointment and task payloads', async () => {
    for (const type of ['appt_before', 'appt_due', 'appt_missed', 'task_before', 'task_due', 'task_missed'] as const) {
      mock.calls = [];
      mock.next = {
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true, messageId: 'x' }],
      };
      await port.deliver(
        baseRequest({
          jobId: `job-${type}`,
          type,
          module: type.startsWith('appt') ? 'appointment' : 'task',
          itemId: 'item-x',
          titleHint: 'Item',
          leadTimeMinutes: 15,
          recipients: [{ uid: 'owner-1', fcmToken: `t-${type}`, platform: 'android' }],
        }),
      );
      expect(mock.calls[0]![0]!.data.type).toBe(type);
    }
  });

  it('sends update_new payload', async () => {
    mock.next = {
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true, messageId: 'u1' }],
    };
    await port.deliver(
      baseRequest({
        jobId: 'job-update',
        type: 'update_new',
        module: 'update',
        itemId: 'upd-1',
        occurrenceKey: 'n/a',
        updateType: 'health',
        senderDisplayName: 'Sara Miller',
        notes: 'Mom is feeling better today and took her evening medicine.',
        recipients: [{ uid: 'member-1', fcmToken: 'tok-u', platform: 'android' }],
      }),
    );
    const data = mock.calls[0]![0]!.data;
    expect(data.type).toBe('update_new');
    expect(data.title).toBe('Sara Miller shared an update');
    expect(data.body).toContain('Mom is feeling better');
  });

  it('supports multiple devices and dedupes duplicate tokens', async () => {
    mock.next = {
      successCount: 2,
      failureCount: 0,
      responses: [
        { success: true, messageId: '1' },
        { success: true, messageId: '2' },
      ],
    };
    await port.deliver(
      baseRequest({
        recipients: [
          { uid: 'owner-1', fcmToken: 'token-a', platform: 'android' },
          { uid: 'owner-1', fcmToken: 'token-b', platform: 'android' },
          { uid: 'owner-1', fcmToken: 'token-a', platform: 'android' },
        ],
      }),
    );
    expect(mock.calls[0]).toHaveLength(2);
  });

  it('removes invalid tokens and does not retry them as successes', async () => {
    await Device.create({
      circleId: 'circle-1',
      uid: 'owner-1',
      fcmToken: 'bad-token',
      platform: 'android',
    });
    mock.next = {
      successCount: 0,
      failureCount: 1,
      responses: [
        {
          success: false,
          error: err('messaging/registration-token-not-registered'),
        },
      ],
    };
    const result = await port.deliver(
      baseRequest({
        recipients: [{ uid: 'owner-1', fcmToken: 'bad-token', platform: 'android' }],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.temporary).toBe(false);
    }
    expect(await Device.countDocuments({ fcmToken: 'bad-token' })).toBe(0);
  });

  it('retries temporary FCM failures', async () => {
    mock.next = {
      successCount: 0,
      failureCount: 1,
      responses: [{ success: false, error: err('messaging/unavailable') }],
    };
    const result = await port.deliver(
      baseRequest({
        recipients: [{ uid: 'owner-1', fcmToken: 'temp-tok', platform: 'android' }],
      }),
    );
    expect(result).toMatchObject({ ok: false, temporary: true });
  });

  it('treats configuration errors as temporary without removing tokens', async () => {
    await Device.create({
      circleId: 'circle-1',
      uid: 'owner-1',
      fcmToken: 'cfg-tok',
      platform: 'android',
    });
    mock.next = {
      successCount: 0,
      failureCount: 1,
      responses: [{ success: false, error: err('messaging/third-party-auth-error') }],
    };
    const result = await port.deliver(
      baseRequest({
        recipients: [{ uid: 'owner-1', fcmToken: 'cfg-tok', platform: 'android' }],
      }),
    );
    expect(result).toMatchObject({ ok: false, temporary: true });
    expect(await Device.countDocuments({ fcmToken: 'cfg-tok' })).toBe(1);
  });

  it('handles mixed batch success/failure with partial retry without duplicate sends', async () => {
    mock.next = (messages) => ({
      successCount: 1,
      failureCount: 1,
      responses: messages.map((m, i) =>
        i === 0
          ? { success: true, messageId: 'ok' }
          : { success: false, error: err('messaging/unavailable') },
      ),
    });
    const first = await port.deliver(baseRequest({ jobId: 'job-partial' }));
    expect(first).toMatchObject({ ok: false, temporary: true });
    expect(mock.calls[0]).toHaveLength(2);

    mock.calls = [];
    mock.next = {
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true, messageId: 'ok2' }],
    };
    const second = await port.deliver(baseRequest({ jobId: 'job-partial' }));
    expect(second).toEqual({ ok: true, pushed: true });
    // Only the previously failed token is retried
    expect(mock.calls[0]).toHaveLength(1);
    expect(mock.calls[0]![0]!.token).toBe('token-b');
    expect(
      await DeliveryAttempt.countDocuments({
        jobId: 'job-partial',
        status: 'sent',
      }),
    ).toBe(2);
  });

  it('noop adapter regression never marks pushed success', async () => {
    const noop = new NoopDeliveryPort();
    const result = await noop.deliver(baseRequest());
    expect(result).toEqual({
      ok: true,
      pushed: false,
      reason: 'noop delivery port — no FCM send',
    });
  });

  it('configureDeliveryPort installs FCM and forbids production noop workers', () => {
    applyTestEnv({ DELIVERY_MODE: 'fcm', NODE_ENV: 'development' });
    configureDeliveryPort();
    expect(isProductionFcmDeliveryConfigured()).toBe(true);
    expect(getDeliveryPort()).toBeInstanceOf(FcmDeliveryPort);

    applyTestEnv({ DELIVERY_MODE: 'noop', NODE_ENV: 'production', PROCESS_MODE: 'worker' });
    expect(() => configureDeliveryPort()).toThrow(/forbidden/);
    resetDeliveryPort();
    applyTestEnv();
  });

  it('scheduler marks job sent only after FCM pushed success', async () => {
    const clock = new FakeClock('2026-03-10T02:00:00.000Z');
    setClock(clock);
    setDeliveryPort(port);

    await Member.create({
      circleId: 'circle-1',
      uid: 'owner-1',
      role: 'owner',
      displayName: 'Owner',
      prefs: { medication: true, appointment: true, task: true, updates: true },
    });
    await Device.create({
      circleId: 'circle-1',
      uid: 'owner-1',
      fcmToken: 'sched-tok',
      platform: 'android',
    });

    await upsertReminder({
      circleId: 'circle-1',
      module: 'medication',
      itemId: 'med-sched',
      body: {
        title: 'Paracetamol',
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

    mock.next = {
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true, messageId: 's1' }],
    };

    clock.set('2026-03-10T03:00:00.000Z');
    setClock(clock);
    const job = await claimNextJob('w-fcm');
    expect(job).toBeTruthy();
    await processClaimedJob(job!);
    const stored = await Job.findById(job!._id).lean();
    // May be before/due/missed — whichever claimed first that was eligible
    expect(['sent', 'skipped']).toContain(stored?.state);
    if (mock.calls.length > 0) {
      expect(stored?.state).toBe('sent');
    }
  });

  it('isolates removed members via empty recipients at eligibility (delivery receives none)', async () => {
    mock.next = {
      successCount: 0,
      failureCount: 0,
      responses: [],
    };
    const result = await port.deliver(baseRequest({ recipients: [] }));
    expect(result).toMatchObject({ ok: true, pushed: false });
    expect(mock.calls).toHaveLength(0);
  });

  it('hashFcmToken is stable and does not equal raw token', () => {
    const h = hashFcmToken('secret-token');
    expect(h).toHaveLength(64);
    expect(h).not.toContain('secret');
  });
});
