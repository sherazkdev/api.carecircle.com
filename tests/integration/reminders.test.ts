import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetEnvCache } from '../../src/config/env.js';
import { Circle } from '../../src/modules/circle/circle.model.js';
import { Completion } from '../../src/modules/completion/completion.model.js';
import { Member } from '../../src/modules/member/member.model.js';
import { ReminderItem } from '../../src/modules/reminder/reminderItem.model.js';
import { Job } from '../../src/scheduler/job.model.js';
import { applyTestEnv } from '../helpers/setupEnv.js';
import { installAuthMock, uninstallAuthMock } from '../helpers/authMock.js';
import { clearAllCollections, startTestMongo, stopTestMongo } from '../helpers/mongoTest.js';

const medPayload = {
  title: 'Paracetamol',
  scheduleMode: 'specificDays' as const,
  repeatDays: [1, 3, 5],
  times: ['08:00', '20:30'],
  startDate: '2026-10-28',
  reminderEnabled: true,
  notifyFamilyOnMiss: true,
  leadTimeMinutes: 10 as const,
  snoozeMinutes: 5 as const,
  reminderTone: 'gentle_chime',
};

const apptPayload = {
  title: 'Cardiology checkup',
  startsAt: '2026-11-02T10:30:00+05:00',
  reminderEnabled: true,
  notifyFamilyOnMiss: true,
  leadTimeMinutes: 30 as const,
  reminderTone: 'gentle_chime',
};

const taskPayload = {
  title: 'Refill pillbox',
  repeatMode: 'custom' as const,
  repeatDays: [0, 6],
  date: '2026-11-02',
  time: '09:00',
  reminderEnabled: true,
  notifyFamilyOnMiss: true,
  leadTimeMinutes: 15 as const,
  reminderTone: 'gentle_chime',
};

async function seedCircle(circleId = 'circle-1') {
  await Circle.create({
    circleId,
    ownerUid: 'owner-1',
    timezone: 'Asia/Karachi',
  });
  await Member.create({
    circleId,
    uid: 'owner-1',
    role: 'owner',
    displayName: 'Owner',
  });
  await Member.create({
    circleId,
    uid: 'member-1',
    role: 'member',
    displayName: 'Member',
  });
}

describe('Phase 5 reminder CRUD and completion', () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    applyTestEnv();
    installAuthMock();
    await startTestMongo();
    app = createApp();
  }, 120_000);

  afterAll(async () => {
    uninstallAuthMock();
    await stopTestMongo();
  });

  beforeEach(async () => {
    applyTestEnv();
    installAuthMock();
    await clearAllCollections();
    await seedCircle();
  });

  afterEach(() => {
    resetEnvCache();
  });

  describe('medication upsert', () => {
    it('allows owner to create medication', async () => {
      const res = await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-1')
        .set('Authorization', 'Bearer user:owner-1')
        .send(medPayload);
      expect(res.status).toBe(200);
      expect(res.body.data.created).toBe(true);
      expect(res.body.data.data.title).toBe('Paracetamol');
      expect(res.body.data.status).toBeNull();
    });

    it('blocks member from creating medication', async () => {
      const res = await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-1')
        .set('Authorization', 'Bearer user:member-1')
        .send(medPayload);
      expect(res.status).toBe(403);
    });

    it('rejects invalid token', async () => {
      const res = await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-1')
        .set('Authorization', 'Bearer invalid')
        .send(medPayload);
      expect(res.status).toBe(401);
    });

    it('edits medication and preserves completions', async () => {
      await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-1')
        .set('Authorization', 'Bearer user:owner-1')
        .send(medPayload);

      await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-1/completion')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ occurrenceKey: '2026-10-28-8-0', completed: true });

      const edit = await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-1')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ ...medPayload, title: 'Paracetamol XR', times: ['08:00', '14:00', '20:30'] });
      expect(edit.status).toBe(200);
      expect(edit.body.data.created).toBe(false);
      expect(edit.body.data.data.times).toHaveLength(3);

      expect(await Completion.countDocuments({ circleId: 'circle-1', itemId: 'med-1' })).toBe(1);
    });

    it('rejects invalid specificDays and payloads', async () => {
      const badDays = await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-bad')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ ...medPayload, repeatDays: [] });
      expect(badDays.status).toBe(400);

      const badTime = await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-bad2')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ ...medPayload, times: ['25:00'] });
      expect(badTime.status).toBe(400);
    });

    it('is idempotent for duplicate upserts', async () => {
      await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-1')
        .set('Authorization', 'Bearer user:owner-1')
        .send(medPayload);
      await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-1')
        .set('Authorization', 'Bearer user:owner-1')
        .send(medPayload);
      expect(await ReminderItem.countDocuments({ module: 'medication', itemId: 'med-1' })).toBe(1);
    });

    it('ignores spoofed identity fields in body', async () => {
      const res = await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-path')
        .set('Authorization', 'Bearer user:owner-1')
        .send({
          ...medPayload,
          circleId: 'other-circle',
          module: 'task',
          itemId: 'spoofed',
          id: 'client-id',
        });
      expect(res.status).toBe(200);
      expect(res.body.data.circleId).toBe('circle-1');
      expect(res.body.data.module).toBe('medication');
      expect(res.body.data.itemId).toBe('med-path');
    });
  });

  describe('appointment and task', () => {
    it('creates and edits appointment preserving status', async () => {
      const created = await request(app)
        .put('/v1/circles/circle-1/reminders/appointment/appt-1')
        .set('Authorization', 'Bearer user:owner-1')
        .send(apptPayload);
      expect(created.status).toBe(200);
      expect(created.body.data.status).toBe('active');

      await request(app)
        .put('/v1/circles/circle-1/reminders/appointment/appt-1/status')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ status: 'completed' });

      const edited = await request(app)
        .put('/v1/circles/circle-1/reminders/appointment/appt-1')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ ...apptPayload, title: 'Follow-up' });
      expect(edited.status).toBe(200);
      expect(edited.body.data.status).toBe('completed');
      expect(edited.body.data.data.title).toBe('Follow-up');
    });

    it('supports task one-time, daily, and custom schedules', async () => {
      const oneTime = await request(app)
        .put('/v1/circles/circle-1/reminders/task/task-once')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ ...taskPayload, repeatMode: 'doesNotRepeat', repeatDays: undefined });
      expect(oneTime.status).toBe(200);

      const daily = await request(app)
        .put('/v1/circles/circle-1/reminders/task/task-daily')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ ...taskPayload, repeatMode: 'daily', itemId: 'ignored' });
      expect(daily.status).toBe(200);

      const custom = await request(app)
        .put('/v1/circles/circle-1/reminders/task/task-custom')
        .set('Authorization', 'Bearer user:owner-1')
        .send(taskPayload);
      expect(custom.status).toBe(200);
      expect(custom.body.data.status).toBe('active');
    });

    it('preserves task status after schedule edit (global completed)', async () => {
      await request(app)
        .put('/v1/circles/circle-1/reminders/task/task-1')
        .set('Authorization', 'Bearer user:owner-1')
        .send(taskPayload);
      await request(app)
        .put('/v1/circles/circle-1/reminders/task/task-1/status')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ status: 'completed' });

      const edited = await request(app)
        .put('/v1/circles/circle-1/reminders/task/task-1')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ ...taskPayload, title: 'Updated task' });
      expect(edited.body.data.status).toBe('completed');
    });
  });

  describe('medication completion', () => {
    beforeEach(async () => {
      await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-1')
        .set('Authorization', 'Bearer user:owner-1')
        .send(medPayload);
    });

    it('completes and undoes a valid occurrence', async () => {
      const done = await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-1/completion')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ occurrenceKey: '2026-10-28-8-0', completed: true });
      expect(done.status).toBe(200);
      expect(done.body.data.completed).toBe(true);

      const undo = await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-1/completion')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ occurrenceKey: '2026-10-28-8-0', completed: false });
      expect(undo.status).toBe(200);
      expect(undo.body.data.completed).toBe(false);
      expect(await Completion.countDocuments()).toBe(1);
    });

    it('rejects invalid occurrences', async () => {
      // Wednesday 2026-10-28 is weekday 3 in Spec (Wed) — in repeatDays [1,3,5] OK.
      // Wrong time:
      const badTime = await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-1/completion')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ occurrenceKey: '2026-10-28-9-0', completed: true });
      expect(badTime.status).toBe(400);

      // Before startDate:
      const before = await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-1/completion')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ occurrenceKey: '2026-10-27-8-0', completed: true });
      expect(before.status).toBe(400);

      // Not a scheduled weekday (Tuesday 2026-10-27 was before start; use 2026-10-29 Thursday = 4)
      const badDay = await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-1/completion')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ occurrenceKey: '2026-10-29-8-0', completed: true });
      expect(badDay.status).toBe(400);

      // Impossible date
      const impossible = await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-1/completion')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ occurrenceKey: '2026-2-30-8-0', completed: true });
      expect(impossible.status).toBe(400);
    });

    it('blocks member completion (C1)', async () => {
      const res = await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-1/completion')
        .set('Authorization', 'Bearer user:member-1')
        .send({ occurrenceKey: '2026-10-28-8-0', completed: true });
      expect(res.status).toBe(403);
    });

    it('returns 404 for nonexistent medication', async () => {
      const res = await request(app)
        .put('/v1/circles/circle-1/reminders/medication/missing/completion')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ occurrenceKey: '2026-10-28-8-0', completed: true });
      expect(res.status).toBe(404);
    });
  });

  describe('status transitions', () => {
    it('transitions appointment and task status idempotently', async () => {
      await request(app)
        .put('/v1/circles/circle-1/reminders/appointment/appt-1')
        .set('Authorization', 'Bearer user:owner-1')
        .send(apptPayload);
      await request(app)
        .put('/v1/circles/circle-1/reminders/task/task-1')
        .set('Authorization', 'Bearer user:owner-1')
        .send(taskPayload);

      for (const path of [
        '/v1/circles/circle-1/reminders/appointment/appt-1/status',
        '/v1/circles/circle-1/reminders/task/task-1/status',
      ]) {
        const completed = await request(app)
          .put(path)
          .set('Authorization', 'Bearer user:owner-1')
          .send({ status: 'completed' });
        expect(completed.status).toBe(200);
        expect(completed.body.data.status).toBe('completed');

        const again = await request(app)
          .put(path)
          .set('Authorization', 'Bearer user:owner-1')
          .send({ status: 'completed' });
        expect(again.status).toBe(200);

        const active = await request(app)
          .put(path)
          .set('Authorization', 'Bearer user:owner-1')
          .send({ status: 'active' });
        expect(active.body.data.status).toBe('active');
      }
    });

    it('rejects invalid status values', async () => {
      await request(app)
        .put('/v1/circles/circle-1/reminders/appointment/appt-1')
        .set('Authorization', 'Bearer user:owner-1')
        .send(apptPayload);
      const res = await request(app)
        .put('/v1/circles/circle-1/reminders/appointment/appt-1/status')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ status: 'done' });
      expect(res.status).toBe(400);
    });
  });

  describe('deletion and isolation', () => {
    it('deletes reminder, completions, and scoped jobs idempotently', async () => {
      await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-1')
        .set('Authorization', 'Bearer user:owner-1')
        .send(medPayload);
      await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-1/completion')
        .set('Authorization', 'Bearer user:owner-1')
        .send({ occurrenceKey: '2026-10-28-8-0', completed: true });
      await Job.create({
        circleId: 'circle-1',
        itemId: 'med-1',
        module: 'medication',
        occurrenceKey: '2026-10-28-8-0',
        type: 'med_due',
        fireAt: new Date(),
        audience: 'owner',
        dedupeKey: 'circle-1:med-1:2026-10-28-8-0:med_due',
        state: 'pending',
      });
      // Shared itemId on another module must not lose its data when med is deleted
      await request(app)
        .put('/v1/circles/circle-1/reminders/task/med-1')
        .set('Authorization', 'Bearer user:owner-1')
        .send(taskPayload);
      await Job.create({
        circleId: 'circle-1',
        itemId: 'med-1',
        module: 'task',
        occurrenceKey: '2026-11-02-9-0',
        type: 'task_due',
        fireAt: new Date(),
        audience: 'owner',
        dedupeKey: 'circle-1:med-1:2026-11-02-9-0:task_due',
        state: 'pending',
      });

      const del = await request(app)
        .delete('/v1/circles/circle-1/reminders/medication/med-1')
        .set('Authorization', 'Bearer user:owner-1');
      expect(del.status).toBe(200);
      expect(del.body.data.cleanup.completions).toBe(1);
      // Planner creates before/due/missed (+ possibly more); all med-module jobs removed.
      expect(del.body.data.cleanup.jobs).toBeGreaterThanOrEqual(1);

      expect(await ReminderItem.findOne({ module: 'medication', itemId: 'med-1' })).toBeNull();
      expect(await ReminderItem.findOne({ module: 'task', itemId: 'med-1' })).not.toBeNull();
      // Task planner creates multiple jobs; medication delete must not remove them.
      expect(await Job.countDocuments({ module: 'task', itemId: 'med-1' })).toBeGreaterThanOrEqual(1);
      expect(await Job.countDocuments({ module: 'medication', itemId: 'med-1' })).toBe(0);
      expect(await Completion.countDocuments({ itemId: 'med-1' })).toBe(0);

      const again = await request(app)
        .delete('/v1/circles/circle-1/reminders/medication/med-1')
        .set('Authorization', 'Bearer user:owner-1');
      expect(again.status).toBe(200);
      expect(again.body.data.deleted).toBe(false);
    });

    it('prevents cross-circle access', async () => {
      await seedCircle('circle-2');
      await request(app)
        .put('/v1/circles/circle-1/reminders/medication/med-1')
        .set('Authorization', 'Bearer user:owner-1')
        .send(medPayload);

      // owner of circle-1 is also owner of circle-2 in seed — create foreign owner
      await Circle.findOneAndUpdate(
        { circleId: 'circle-2' },
        { $set: { ownerUid: 'owner-2' } },
      );
      await Member.deleteOne({ circleId: 'circle-2', uid: 'owner-1' });
      await Member.create({
        circleId: 'circle-2',
        uid: 'owner-2',
        role: 'owner',
        displayName: 'Owner 2',
      });

      const res = await request(app)
        .put('/v1/circles/circle-2/reminders/medication/med-1')
        .set('Authorization', 'Bearer user:owner-1')
        .send(medPayload);
      expect(res.status).toBe(403);
    });
  });
});
