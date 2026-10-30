import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { Circle } from '../../src/modules/circle/circle.model.js';
import { Completion } from '../../src/modules/completion/completion.model.js';
import { Device } from '../../src/modules/device/device.model.js';
import { Member } from '../../src/modules/member/member.model.js';
import {
  deleteReminder,
  setAppointmentStatus,
  setMedicationCompletion,
  setTaskStatus,
  upsertReminder,
} from '../../src/modules/reminder/reminder.service.js';
import {
  FakeClock,
  NoopDeliveryPort,
  RecordingDeliveryPort,
  claimNextJob,
  processClaimedJob,
  resetClock,
  resetDeliveryPort,
  setClock,
  setDeliveryPort,
  toOccurrenceKey,
  resolveLocalDateTime,
} from '../../src/scheduler/index.js';
import { Job } from '../../src/scheduler/job.model.js';
import { SchedulerWorker } from '../../src/scheduler/worker.js';
import { markJobRetryOrFail } from '../../src/scheduler/claimJobs.js';
import { applyTestEnv } from '../helpers/setupEnv.js';
import { clearAllCollections, startTestMongo, stopTestMongo } from '../helpers/mongoTest.js';

const medBase = {
  title: 'Paracetamol',
  scheduleMode: 'daily' as const,
  times: ['08:00', '20:00'],
  startDate: '2026-03-01',
  reminderEnabled: true,
  notifyFamilyOnMiss: true,
  leadTimeMinutes: 10 as const,
  snoozeMinutes: 5 as const,
  reminderTone: 'gentle_chime',
};

async function seedCircle(timezone = 'Asia/Karachi', circleId = 'circle-1') {
  await Circle.create({ circleId, ownerUid: 'owner-1', timezone });
  await Member.create({
    circleId,
    uid: 'owner-1',
    role: 'owner',
    displayName: 'Owner',
    prefs: { medication: true, appointment: true, task: true, updates: true },
  });
  await Member.create({
    circleId,
    uid: 'member-1',
    role: 'member',
    displayName: 'Family',
    prefs: { medication: true, appointment: true, task: true, updates: true },
  });
  await Device.create({
    circleId,
    uid: 'owner-1',
    fcmToken: 'owner-token',
    platform: 'android',
  });
  await Device.create({
    circleId,
    uid: 'member-1',
    fcmToken: 'member-token',
    platform: 'android',
  });
}

async function drainDue(workerId = 'w1', max = 20): Promise<number> {
  let n = 0;
  for (let i = 0; i < max; i++) {
    const job = await claimNextJob(workerId);
    if (!job) break;
    await processClaimedJob(job);
    n += 1;
  }
  return n;
}

describe('Phase 6 scheduler engine', () => {
  let clock: FakeClock;
  let delivery: RecordingDeliveryPort;

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
    clock = new FakeClock('2026-03-10T02:00:00.000Z'); // 07:00 Asia/Karachi
    setClock(clock);
    delivery = new RecordingDeliveryPort();
    setDeliveryPort(delivery);
    await seedCircle('Asia/Karachi');
  });

  afterEach(() => {
    resetClock();
    resetDeliveryPort();
  });

  it('plans daily medication with multiple times, before/due/missed', async () => {
    const res = await upsertReminder({
      circleId: 'circle-1',
      module: 'medication',
      itemId: 'med-1',
      body: medBase,
    });
    expect(res.jobsPlanned).toBeGreaterThan(0);

    const jobs = await Job.find({ itemId: 'med-1' }).lean();
    const types = new Set(jobs.map((j) => j.type));
    expect(types.has('med_before')).toBe(true);
    expect(types.has('med_due')).toBe(true);
    expect(types.has('med_missed')).toBe(true);
    // Next occurrences for both 08:00 and 20:00 streams
    expect(jobs.filter((j) => j.type === 'med_due')).toHaveLength(2);

    const due08 = jobs.find((j) => j.type === 'med_due' && j.occurrenceKey.endsWith('-8-0'));
    const before08 = jobs.find(
      (j) => j.type === 'med_before' && j.occurrenceKey === due08?.occurrenceKey,
    );
    const missed08 = jobs.find(
      (j) => j.type === 'med_missed' && j.occurrenceKey === due08?.occurrenceKey,
    );
    expect(due08 && before08 && missed08).toBeTruthy();
    expect(before08!.fireAt.getTime()).toBe(due08!.fireAt.getTime() - 10 * 60_000);
    expect(missed08!.fireAt.getTime()).toBe(due08!.fireAt.getTime()); // C5 grace 0
  });

  it('respects specific weekdays and startDate', async () => {
    clock.set('2026-03-09T03:00:00.000Z'); // Mon 08:00 PKT approx
    setClock(clock);
    await upsertReminder({
      circleId: 'circle-1',
      module: 'medication',
      itemId: 'med-wd',
      body: {
        ...medBase,
        scheduleMode: 'specificDays',
        repeatDays: [1, 3, 5],
        times: ['09:00'],
        startDate: '2026-03-11',
      },
    });
    const due = await Job.findOne({ itemId: 'med-wd', type: 'med_due' }).lean();
    expect(due).toBeTruthy();
    // First allowed day on/after startDate Wed 11 Mar 2026
    expect(due!.occurrenceKey.startsWith('2026-3-11-')).toBe(true);
  });

  it('plans appointment and tasks (one-time, daily, custom)', async () => {
    await upsertReminder({
      circleId: 'circle-1',
      module: 'appointment',
      itemId: 'appt-1',
      body: {
        title: 'Checkup',
        startsAt: '2026-03-15T10:30:00+05:00',
        reminderEnabled: true,
        notifyFamilyOnMiss: true,
        leadTimeMinutes: 30,
        reminderTone: 'gentle_chime',
      },
    });
    expect(await Job.countDocuments({ itemId: 'appt-1', type: 'appt_due' })).toBe(1);

    await upsertReminder({
      circleId: 'circle-1',
      module: 'task',
      itemId: 'task-once',
      body: {
        title: 'Once',
        repeatMode: 'doesNotRepeat',
        date: '2026-03-12',
        time: '11:00',
        reminderEnabled: true,
        notifyFamilyOnMiss: false,
        leadTimeMinutes: 5,
        reminderTone: 'gentle_chime',
      },
    });
    await upsertReminder({
      circleId: 'circle-1',
      module: 'task',
      itemId: 'task-daily',
      body: {
        title: 'Daily',
        repeatMode: 'daily',
        date: '2026-03-10',
        time: '12:00',
        reminderEnabled: true,
        notifyFamilyOnMiss: true,
        leadTimeMinutes: 5,
        reminderTone: 'gentle_chime',
      },
    });
    await upsertReminder({
      circleId: 'circle-1',
      module: 'task',
      itemId: 'task-custom',
      body: {
        title: 'Custom',
        repeatMode: 'custom',
        repeatDays: [0, 6],
        date: '2026-03-10',
        time: '13:00',
        reminderEnabled: true,
        notifyFamilyOnMiss: true,
        leadTimeMinutes: 5,
        reminderTone: 'gentle_chime',
      },
    });
    expect(await Job.countDocuments({ module: 'task', type: 'task_due' })).toBe(3);
  });

  it('delivers before/due to owner and missed to family independently of reminderEnabled', async () => {
    await upsertReminder({
      circleId: 'circle-1',
      module: 'medication',
      itemId: 'med-flags',
      body: {
        ...medBase,
        times: ['08:00'],
        reminderEnabled: false,
        notifyFamilyOnMiss: true,
        leadTimeMinutes: 10,
        snoozeMinutes: 0,
      },
    });

    // Jump to after 08:00 PKT on Mar 10 = 03:00Z
    clock.set('2026-03-10T03:05:00.000Z');
    setClock(clock);
    await drainDue();

    const types = delivery.requests.map((r) => r.type);
    expect(types.includes('med_before')).toBe(false);
    expect(types.includes('med_due')).toBe(false);
    expect(types.includes('med_missed')).toBe(true);
    expect(delivery.requests.find((r) => r.type === 'med_missed')?.recipients[0]?.uid).toBe(
      'member-1',
    );
  });

  it('skips completed medication occurrence and supports snooze cutoffs', async () => {
    await upsertReminder({
      circleId: 'circle-1',
      module: 'medication',
      itemId: 'med-snooze',
      body: { ...medBase, times: ['08:00'], snoozeMinutes: 5, leadTimeMinutes: 5 },
    });

    clock.set('2026-03-10T03:00:00.000Z');
    setClock(clock);
    await drainDue('snooze-w');

    expect(delivery.requests.some((r) => r.type === 'med_due')).toBe(true);
    expect(await Job.countDocuments({ itemId: 'med-snooze', type: 'med_snooze', state: 'pending' })).toBe(
      1,
    );

    // Complete dose → cancel snooze
    const dueKey = (await Job.findOne({ itemId: 'med-snooze', type: 'med_due' }).lean())!
      .occurrenceKey;
    await setMedicationCompletion({
      circleId: 'circle-1',
      itemId: 'med-snooze',
      uid: 'owner-1',
      occurrenceKey: dueKey,
      completed: true,
    });
    expect(
      await Job.countDocuments({
        itemId: 'med-snooze',
        occurrenceKey: dueKey,
        type: 'med_snooze',
        state: 'pending',
      }),
    ).toBe(0);
  });

  it('runs snooze repetition until two-hour cutoff', async () => {
    await upsertReminder({
      circleId: 'circle-1',
      module: 'medication',
      itemId: 'med-cap',
      body: {
        ...medBase,
        times: ['08:00'],
        snoozeMinutes: 15,
        leadTimeMinutes: 5,
        startDate: '2026-03-10',
      },
    });
    clock.set('2026-03-10T03:00:00.000Z');
    setClock(clock);
    delivery.reset();
    await drainDue('cap1');

    // Process snoozes until 2h cutoff (15m interval ⇒ ≤ 8 snoozes)
    for (let i = 0; i < 10; i++) {
      clock.advanceMinutes(15);
      setClock(clock);
      await drainDue(`cap-${i}`);
    }
    const snoozeSent = await Job.countDocuments({
      itemId: 'med-cap',
      type: 'med_snooze',
      state: 'sent',
    });
    expect(snoozeSent).toBeGreaterThan(0);
    expect(snoozeSent).toBeLessThanOrEqual(8);
    expect(
      await Job.countDocuments({ itemId: 'med-cap', type: 'med_snooze', state: 'pending' }),
    ).toBe(0);
  });

  it('stops snooze at the next scheduled dose', async () => {
    await upsertReminder({
      circleId: 'circle-1',
      module: 'medication',
      itemId: 'med-nextdose',
      body: {
        ...medBase,
        times: ['08:00', '08:30'],
        snoozeMinutes: 15,
        leadTimeMinutes: 5,
        startDate: '2026-03-10',
      },
    });
    clock.set('2026-03-10T03:00:00.000Z'); // 08:00 PKT
    setClock(clock);
    delivery.reset();
    await drainDue('nd1');

    // First snooze at 08:15 is allowed; 08:30 would be next dose cutoff
    clock.advanceMinutes(15);
    setClock(clock);
    await drainDue('nd2');
    clock.advanceMinutes(15);
    setClock(clock);
    await drainDue('nd3');

    const snoozesFor0800 = await Job.find({
      itemId: 'med-nextdose',
      type: 'med_snooze',
      occurrenceKey: { $regex: /-8-0$/ },
    }).lean();
    expect(snoozesFor0800.filter((j) => j.state === 'sent')).toHaveLength(1);
    expect(snoozesFor0800.filter((j) => j.state === 'pending')).toHaveLength(0);
  });

  it('skips delivery at send time when medication occurrence is completed', async () => {
    await upsertReminder({
      circleId: 'circle-1',
      module: 'medication',
      itemId: 'med-exec',
      body: { ...medBase, times: ['08:00'], snoozeMinutes: 0, leadTimeMinutes: 5 },
    });
    const due = await Job.findOne({ itemId: 'med-exec', type: 'med_due' }).lean();
    expect(due).toBeTruthy();
    await Completion.create({
      circleId: 'circle-1',
      itemId: 'med-exec',
      occurrenceKey: due!.occurrenceKey,
      completed: true,
      updatedBy: 'owner-1',
    });
    clock.set('2026-03-10T03:00:00.000Z');
    setClock(clock);
    delivery.reset();
    await drainDue('exec');
    expect(delivery.requests.some((r) => r.type === 'med_due')).toBe(false);
    expect(
      (await Job.findOne({ itemId: 'med-exec', type: 'med_due' }).lean())?.state,
    ).toBe('skipped');
  });

  it('noop delivery never marks jobs as sent', async () => {
    setDeliveryPort(new NoopDeliveryPort());
    await upsertReminder({
      circleId: 'circle-1',
      module: 'medication',
      itemId: 'med-noop',
      body: { ...medBase, times: ['08:00'], snoozeMinutes: 0, leadTimeMinutes: 5 },
    });
    clock.set('2026-03-10T03:00:00.000Z');
    setClock(clock);
    await drainDue('noop-w');
    expect(await Job.countDocuments({ itemId: 'med-noop', state: 'sent' })).toBe(0);
    expect(await Job.countDocuments({ itemId: 'med-noop', state: 'skipped' })).toBeGreaterThan(0);
  });

  it('invalidates jobs on edit/delete and preserves completions', async () => {
    await upsertReminder({
      circleId: 'circle-1',
      module: 'medication',
      itemId: 'med-edit',
      body: { ...medBase, times: ['08:00'], snoozeMinutes: 0 },
    });
    const beforeCount = await Job.countDocuments({ itemId: 'med-edit', state: 'pending' });
    expect(beforeCount).toBeGreaterThan(0);

    await upsertReminder({
      circleId: 'circle-1',
      module: 'medication',
      itemId: 'med-edit',
      body: { ...medBase, times: ['09:00'], title: 'Renamed', snoozeMinutes: 0 },
    });
    const dues = await Job.find({ itemId: 'med-edit', type: 'med_due', state: 'pending' }).lean();
    expect(dues.every((j) => j.occurrenceKey.includes('-9-0'))).toBe(true);

    await setMedicationCompletion({
      circleId: 'circle-1',
      itemId: 'med-edit',
      uid: 'owner-1',
      occurrenceKey: dues[0]!.occurrenceKey,
      completed: true,
    });
    await upsertReminder({
      circleId: 'circle-1',
      module: 'medication',
      itemId: 'med-edit',
      body: { ...medBase, times: ['09:00'], title: 'Still', snoozeMinutes: 0 },
    });
    expect(await Completion.countDocuments({ itemId: 'med-edit' })).toBe(1);

    await deleteReminder({ circleId: 'circle-1', module: 'medication', itemId: 'med-edit' });
    expect(await Job.countDocuments({ itemId: 'med-edit', state: 'pending' })).toBe(0);
  });

  it('stops appointment/task jobs on completed and regenerates on active', async () => {
    await upsertReminder({
      circleId: 'circle-1',
      module: 'appointment',
      itemId: 'appt-2',
      body: {
        title: 'A',
        startsAt: '2026-03-20T10:00:00+05:00',
        reminderEnabled: true,
        notifyFamilyOnMiss: true,
        leadTimeMinutes: 15,
        reminderTone: 'gentle_chime',
      },
    });
    await setAppointmentStatus({ circleId: 'circle-1', itemId: 'appt-2', status: 'completed' });
    expect(await Job.countDocuments({ itemId: 'appt-2', state: 'pending' })).toBe(0);

    await setAppointmentStatus({ circleId: 'circle-1', itemId: 'appt-2', status: 'active' });
    expect(await Job.countDocuments({ itemId: 'appt-2', state: 'pending' })).toBeGreaterThan(0);

    await upsertReminder({
      circleId: 'circle-1',
      module: 'task',
      itemId: 'task-2',
      body: {
        title: 'T',
        repeatMode: 'daily',
        date: '2026-03-10',
        time: '15:00',
        reminderEnabled: true,
        notifyFamilyOnMiss: true,
        leadTimeMinutes: 5,
        reminderTone: 'gentle_chime',
      },
    });
    await setTaskStatus({ circleId: 'circle-1', itemId: 'task-2', status: 'completed' });
    expect(await Job.countDocuments({ itemId: 'task-2', state: 'pending' })).toBe(0);
    await setTaskStatus({ circleId: 'circle-1', itemId: 'task-2', status: 'active' });
    expect(await Job.countDocuments({ itemId: 'task-2', state: 'pending' })).toBeGreaterThan(0);
  });

  it('undo does not replay past due notifications', async () => {
    await upsertReminder({
      circleId: 'circle-1',
      module: 'medication',
      itemId: 'med-undo',
      body: { ...medBase, times: ['08:00'], snoozeMinutes: 0, leadTimeMinutes: 5 },
    });
    clock.set('2026-03-10T03:00:00.000Z');
    setClock(clock);
    await drainDue('undo1');
    const due = await Job.findOne({ itemId: 'med-undo', type: 'med_due', state: 'sent' }).lean();
    expect(due).toBeTruthy();

    await setMedicationCompletion({
      circleId: 'circle-1',
      itemId: 'med-undo',
      uid: 'owner-1',
      occurrenceKey: due!.occurrenceKey,
      completed: true,
    });
    await setMedicationCompletion({
      circleId: 'circle-1',
      itemId: 'med-undo',
      uid: 'owner-1',
      occurrenceKey: due!.occurrenceKey,
      completed: false,
    });
    expect(
      await Job.countDocuments({
        itemId: 'med-undo',
        occurrenceKey: due!.occurrenceKey,
        type: 'med_due',
        state: 'pending',
      }),
    ).toBe(0);
  });

  it('handles timezone conversion and midnight rollover keys', async () => {
    await clearAllCollections();
    await seedCircle('America/New_York', 'circle-ny');
    clock.set('2026-03-10T03:30:00.000Z'); // still Mar 9 evening in NY
    setClock(clock);
    await upsertReminder({
      circleId: 'circle-ny',
      module: 'medication',
      itemId: 'med-ny',
      body: { ...medBase, times: ['00:15'], startDate: '2026-03-01', snoozeMinutes: 0 },
    });
    const due = await Job.findOne({ circleId: 'circle-ny', type: 'med_due' }).lean();
    expect(due?.occurrenceKey).toMatch(/^2026-\d+-\d+-0-15$/);
  });

  it('applies DST spring-forward and fall-back policies', () => {
    // US spring forward 2026-03-08: 2:30 does not exist in America/New_York
    const spring = resolveLocalDateTime('America/New_York', 2026, 3, 8, 2, 30);
    expect(spring.isValid).toBe(true);
    expect(spring.hour).toBeGreaterThanOrEqual(3);

    // Fall back 2026-11-01 01:30 — earlier offset
    const fall = resolveLocalDateTime('America/New_York', 2026, 11, 1, 1, 30);
    expect(fall.isValid).toBe(true);
    expect(toOccurrenceKey(fall)).toBe('2026-11-1-1-30');
  });

  it('supports concurrent workers with single claim winner', async () => {
    await Job.deleteMany({});
    const fireAt = new Date('2026-03-10T03:00:00.000Z');
    await Job.create({
      circleId: 'circle-1',
      itemId: 'med-race',
      module: 'medication',
      occurrenceKey: '2026-3-10-8-0',
      type: 'med_due',
      fireAt,
      audience: 'owner',
      dedupeKey: 'circle-1:med-race:2026-3-10-8-0:med_due',
      state: 'pending',
      sent: false,
    });
    clock.set('2026-03-10T03:00:00.000Z');
    setClock(clock);

    const [a, b] = await Promise.all([claimNextJob('wa'), claimNextJob('wb')]);
    const claimed = [a, b].filter(Boolean);
    expect(claimed).toHaveLength(1);
    expect([a, b].filter((j) => j === null)).toHaveLength(1);
  });

  it('recovers expired leases and retries temporary failures', async () => {
    await upsertReminder({
      circleId: 'circle-1',
      module: 'medication',
      itemId: 'med-lease',
      body: { ...medBase, times: ['08:00'], leadTimeMinutes: 5, snoozeMinutes: 0 },
    });
    clock.set('2026-03-10T03:00:00.000Z');
    setClock(clock);
    process.env.SCHEDULER_LEASE_MS = '1000';

    const job = await claimNextJob('lease-w');
    expect(job?.state).toBe('claimed');
    // Expire lease
    clock.advanceMs(2000);
    setClock(clock);
    const reclaimed = await claimNextJob('lease-w2');
    expect(reclaimed?.dedupeKey).toBe(job!.dedupeKey);
    expect(reclaimed?.claimedBy).toBe('lease-w2');

    delivery.nextResult = { ok: false, temporary: true, message: 'fcm timeout' };
    await processClaimedJob(reclaimed!);
    const pending = await Job.findById(reclaimed!._id).lean();
    expect(pending?.state).toBe('pending');
    expect(pending?.attempts).toBe(1);

    // Force permanent fail
    process.env.SCHEDULER_MAX_ATTEMPTS = '2';
    delivery.nextResult = { ok: false, temporary: true, message: 'still failing' };
    clock.advanceMinutes(1);
    setClock(clock);
    const again = await claimNextJob('lease-w3');
    await processClaimedJob(again!);
    expect((await Job.findById(again!._id).lean())?.state).toBe('failed');

    delete process.env.SCHEDULER_LEASE_MS;
    delete process.env.SCHEDULER_MAX_ATTEMPTS;
  });

  it('prevents duplicate jobs and isolates circles', async () => {
    await upsertReminder({
      circleId: 'circle-1',
      module: 'medication',
      itemId: 'med-dup',
      body: { ...medBase, times: ['08:00'], snoozeMinutes: 0 },
    });
    const count1 = await Job.countDocuments({ itemId: 'med-dup' });
    await upsertReminder({
      circleId: 'circle-1',
      module: 'medication',
      itemId: 'med-dup',
      body: { ...medBase, times: ['08:00'], snoozeMinutes: 0 },
    });
    // Replan replaces unfinished then inserts same dedupe keys once
    expect(await Job.countDocuments({ itemId: 'med-dup', state: 'pending' })).toBeLessThanOrEqual(
      count1,
    );

    await seedCircle('UTC', 'circle-2');
    await upsertReminder({
      circleId: 'circle-2',
      module: 'medication',
      itemId: 'med-dup',
      body: { ...medBase, times: ['08:00'], snoozeMinutes: 0 },
    });
    expect(await Job.countDocuments({ circleId: 'circle-2', itemId: 'med-dup' })).toBeGreaterThan(0);
    expect(await Job.countDocuments({ circleId: 'circle-1', itemId: 'med-dup' })).toBeGreaterThan(0);
  });

  it('filters recipients by notification preferences', async () => {
    await Member.updateOne(
      { circleId: 'circle-1', uid: 'member-1' },
      { $set: { 'prefs.medication': false } },
    );
    await upsertReminder({
      circleId: 'circle-1',
      module: 'medication',
      itemId: 'med-pref',
      body: {
        ...medBase,
        times: ['08:00'],
        reminderEnabled: false,
        notifyFamilyOnMiss: true,
        leadTimeMinutes: 5,
        snoozeMinutes: 0,
      },
    });
    clock.set('2026-03-10T03:00:00.000Z');
    setClock(clock);
    delivery.reset();
    await drainDue('pref');
    expect(delivery.requests.filter((r) => r.type === 'med_missed')).toHaveLength(0);
  });

  it('worker tick processes due jobs (restart-safe polling)', async () => {
    await upsertReminder({
      circleId: 'circle-1',
      module: 'medication',
      itemId: 'med-worker',
      body: { ...medBase, times: ['08:00'], leadTimeMinutes: 5, snoozeMinutes: 0 },
    });
    clock.set('2026-03-10T03:00:00.000Z');
    setClock(clock);
    const worker = new SchedulerWorker({ workerId: 'tick-w', pollIntervalMs: 60_000 });
    const n = await worker.tick();
    expect(n).toBeGreaterThan(0);
    await worker.stop();
  });

  it('markJobRetryOrFail helper advances attempts', async () => {
    await Job.create({
      circleId: 'circle-1',
      itemId: 'x',
      module: 'medication',
      occurrenceKey: '2026-3-10-8-0',
      type: 'med_due',
      fireAt: new Date(),
      audience: 'owner',
      dedupeKey: 'circle-1:x:2026-3-10-8-0:med_due',
      state: 'claimed',
      claimedBy: 'w',
      claimedAt: new Date(),
      attempts: 0,
      sent: false,
    });
    const doc = await Job.findOne({ itemId: 'x' });
    await markJobRetryOrFail(String(doc!._id), 0, 'temp');
    expect((await Job.findById(doc!._id).lean())?.state).toBe('pending');
  });

  it('UTC timezone planning uses local keys', async () => {
    await clearAllCollections();
    await seedCircle('UTC', 'circle-utc');
    clock.set('2026-06-01T10:00:00.000Z');
    setClock(clock);
    await upsertReminder({
      circleId: 'circle-utc',
      module: 'medication',
      itemId: 'med-utc',
      body: { ...medBase, times: ['12:00'], startDate: '2026-06-01', snoozeMinutes: 0 },
    });
    const due = await Job.findOne({ itemId: 'med-utc', type: 'med_due' }).lean();
    expect(due?.occurrenceKey).toBe('2026-6-1-12-0');
    const local = DateTime.fromJSDate(due!.fireAt, { zone: 'utc' });
    expect(local.hour).toBe(12);
  });
});
