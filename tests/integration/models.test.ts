import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Circle } from '../../src/modules/circle/circle.model.js';
import { Completion } from '../../src/modules/completion/completion.model.js';
import { Device } from '../../src/modules/device/device.model.js';
import { Member } from '../../src/modules/member/member.model.js';
import { ReminderItem } from '../../src/modules/reminder/reminderItem.model.js';
import { Job, buildJobDedupeKey } from '../../src/scheduler/job.model.js';
import {
  deleteCircleCascade,
  deleteReminderCascade,
  removeMemberFromCircle,
} from '../../src/shared/db/cascades.js';
import { listCollectionIndexNames } from '../../src/shared/db/ensureIndexes.js';
import { clearAllCollections, startTestMongo, stopTestMongo } from '../helpers/mongoTest.js';

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: number }).code === 11000
  );
}

const medicationData = {
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

const appointmentData = {
  title: 'Cardiology checkup',
  startsAt: '2026-11-02T10:30:00+05:00',
  reminderEnabled: true,
  notifyFamilyOnMiss: true,
  leadTimeMinutes: 30 as const,
  reminderTone: 'gentle_chime',
};

const taskData = {
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

describe('Phase 2 database models', () => {
  beforeAll(async () => {
    await startTestMongo();
  }, 120_000);

  afterAll(async () => {
    await stopTestMongo();
  });

  beforeEach(async () => {
    await clearAllCollections();
  });

  describe('creation and validation', () => {
    it('creates a circle with timestamps and valid timezone', async () => {
      const circle = await Circle.create({
        circleId: 'circle-1',
        ownerUid: 'owner-1',
        timezone: 'Asia/Karachi',
      });
      expect(circle.circleId).toBe('circle-1');
      expect(circle.createdAt).toBeInstanceOf(Date);
      expect(circle.updatedAt).toBeInstanceOf(Date);
    });

    it('creates member with default prefs', async () => {
      const member = await Member.create({
        circleId: 'circle-1',
        uid: 'owner-1',
        role: 'owner',
        displayName: 'Owner',
      });
      expect(member.prefs.medication).toBe(true);
      expect(member.prefs.updates).toBe(true);
    });

    it('creates medication / appointment / task reminder items', async () => {
      await ReminderItem.create({
        circleId: 'c1',
        module: 'medication',
        itemId: 'med-1',
        data: medicationData,
      });
      await ReminderItem.create({
        circleId: 'c1',
        module: 'appointment',
        itemId: 'appt-1',
        data: appointmentData,
        status: 'active',
      });
      await ReminderItem.create({
        circleId: 'c1',
        module: 'task',
        itemId: 'task-1',
        data: taskData,
        status: 'active',
      });
      expect(await ReminderItem.countDocuments()).toBe(3);
    });
  });

  describe('uniqueness constraints', () => {
    it('prevents duplicate circle membership (circleId + uid)', async () => {
      await Member.create({
        circleId: 'c1',
        uid: 'u1',
        role: 'member',
        displayName: 'Sara',
      });
      await expect(
        Member.create({
          circleId: 'c1',
          uid: 'u1',
          role: 'member',
          displayName: 'Sara 2',
        }),
      ).rejects.toSatisfy(isDuplicateKeyError);
    });

    it('enforces unique (circleId, fcmToken) and supports R4 reassignment purge', async () => {
      await Device.create({
        circleId: 'c1',
        uid: 'old-user',
        fcmToken: 'token-abc',
        platform: 'android',
      });
      await Device.create({
        circleId: 'c2',
        uid: 'old-user',
        fcmToken: 'token-abc',
        platform: 'android',
      });

      await expect(
        Device.create({
          circleId: 'c1',
          uid: 'new-user',
          fcmToken: 'token-abc',
          platform: 'ios',
        }),
      ).rejects.toSatisfy(isDuplicateKeyError);

      const released = await Device.releaseTokenFromOtherUsers('token-abc', 'new-user');
      expect(released.deletedCount).toBe(2);

      await Device.create({
        circleId: 'c1',
        uid: 'new-user',
        fcmToken: 'token-abc',
        platform: 'ios',
      });
      expect(await Device.countDocuments({ fcmToken: 'token-abc', uid: 'new-user' })).toBe(1);
    });

    it('enforces reminder uniqueness per circle/module/itemId', async () => {
      await ReminderItem.create({
        circleId: 'c1',
        module: 'medication',
        itemId: 'med-1',
        data: medicationData,
      });
      await expect(
        ReminderItem.create({
          circleId: 'c1',
          module: 'medication',
          itemId: 'med-1',
          data: { ...medicationData, title: 'Other' },
        }),
      ).rejects.toSatisfy(isDuplicateKeyError);

      // Same itemId allowed for a different module
      await ReminderItem.create({
        circleId: 'c1',
        module: 'task',
        itemId: 'med-1',
        data: taskData,
        status: 'active',
      });
    });

    it('enforces medication completion uniqueness per occurrenceKey', async () => {
      await Completion.create({
        circleId: 'c1',
        itemId: 'med-1',
        occurrenceKey: '2026-10-28-8-0',
        completed: true,
        updatedBy: 'owner-1',
      });
      await expect(
        Completion.create({
          circleId: 'c1',
          itemId: 'med-1',
          occurrenceKey: '2026-10-28-8-0',
          completed: false,
          updatedBy: 'owner-1',
        }),
      ).rejects.toSatisfy(isDuplicateKeyError);

      // Idempotent upsert path
      await Completion.findOneAndUpdate(
        { circleId: 'c1', itemId: 'med-1', occurrenceKey: '2026-10-28-8-0' },
        { $set: { completed: false, updatedBy: 'owner-1' } },
        { upsert: true, returnDocument: 'after' },
      );
      expect(await Completion.countDocuments()).toBe(1);
    });

    it('prevents duplicate scheduled jobs via dedupeKey', async () => {
      const dedupeKey = buildJobDedupeKey({
        circleId: 'c1',
        itemId: 'med-1',
        occurrenceKey: '2026-10-28-8-0',
        type: 'med_due',
      });

      await Job.create({
        circleId: 'c1',
        itemId: 'med-1',
        module: 'medication',
        occurrenceKey: '2026-10-28-8-0',
        type: 'med_due',
        fireAt: new Date('2026-10-28T03:00:00.000Z'),
        audience: 'owner',
        dedupeKey,
        state: 'pending',
      });

      await expect(
        Job.create({
          circleId: 'c1',
          itemId: 'med-1',
          module: 'medication',
          occurrenceKey: '2026-10-28-8-0',
          type: 'med_due',
          fireAt: new Date('2026-10-28T03:00:00.000Z'),
          audience: 'owner',
          dedupeKey,
          state: 'pending',
        }),
      ).rejects.toSatisfy(isDuplicateKeyError);
    });
  });

  describe('invalid values', () => {
    it('rejects invalid timezone', async () => {
      await expect(
        Circle.create({
          circleId: 'c1',
          ownerUid: 'u1',
          timezone: 'Not/AZone',
        }),
      ).rejects.toThrow(/IANA|timezone|validation/i);
    });

    it('rejects invalid module and reminder data', async () => {
      await expect(
        ReminderItem.create({
          circleId: 'c1',
          module: 'not-a-module',
          itemId: 'x',
          data: medicationData,
        } as never),
      ).rejects.toThrow();

      await expect(
        ReminderItem.create({
          circleId: 'c1',
          module: 'medication',
          itemId: 'med-bad',
          data: { ...medicationData, scheduleMode: 'hourly' },
        }),
      ).rejects.toThrow();

      await expect(
        ReminderItem.create({
          circleId: 'c1',
          module: 'task',
          itemId: 'task-bad',
          data: { ...taskData, repeatMode: 'weekly' },
          status: 'active',
        }),
      ).rejects.toThrow();
    });

    it('rejects medication with status and appointment without status', async () => {
      await expect(
        ReminderItem.create({
          circleId: 'c1',
          module: 'medication',
          itemId: 'med-1',
          data: medicationData,
          status: 'active',
        }),
      ).rejects.toThrow(/Completion|status/i);

      await expect(
        ReminderItem.create({
          circleId: 'c1',
          module: 'appointment',
          itemId: 'appt-1',
          data: appointmentData,
        }),
      ).rejects.toThrow(/status/i);
    });

    it('rejects invalid occurrenceKey on completion', async () => {
      await expect(
        Completion.create({
          circleId: 'c1',
          itemId: 'med-1',
          occurrenceKey: '2026-10-28T08:00',
          completed: true,
          updatedBy: 'u1',
        }),
      ).rejects.toThrow(/occurrenceKey/i);
    });
  });

  describe('job claim and retry fields', () => {
    it('requires claim metadata when state is claimed and syncs sent flag', async () => {
      await expect(
        Job.create({
          circleId: 'c1',
          itemId: 'med-1',
          module: 'medication',
          occurrenceKey: '2026-10-28-8-0',
          type: 'med_due',
          fireAt: new Date(),
          audience: 'owner',
          dedupeKey: 'c1:med-1:2026-10-28-8-0:med_due',
          state: 'claimed',
          attempts: 1,
        }),
      ).rejects.toThrow(/claimedBy|claimedAt/i);

      const job = await Job.create({
        circleId: 'c1',
        itemId: 'med-1',
        module: 'medication',
        occurrenceKey: '2026-10-28-8-0',
        type: 'med_due',
        fireAt: new Date(),
        audience: 'owner',
        dedupeKey: 'c1:med-1:2026-10-28-8-0:med_due',
        state: 'claimed',
        claimedBy: 'worker-1',
        claimedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
        attempts: 1,
        nextAttemptAt: new Date(Date.now() + 5_000),
      });
      expect(job.sent).toBe(false);

      job.state = 'sent';
      await job.validate();
      expect(job.sent).toBe(true);
    });

    it('rejects negative attempts', async () => {
      await expect(
        Job.create({
          circleId: 'c1',
          itemId: 'med-1',
          module: 'medication',
          occurrenceKey: '2026-10-28-8-0',
          type: 'med_snooze',
          fireAt: new Date(),
          audience: 'owner',
          dedupeKey: 'c1:med-1:2026-10-28-8-0:med_snooze',
          state: 'pending',
          attempts: -1,
        }),
      ).rejects.toThrow();
    });
  });

  describe('indexes', () => {
    it('creates expected unique and compound indexes in MongoDB', async () => {
      const circleIdx = await listCollectionIndexNames('circles');
      expect(circleIdx).toEqual(expect.arrayContaining(['uniq_circleId', 'idx_ownerUid']));

      const memberIdx = await listCollectionIndexNames('members');
      expect(memberIdx).toEqual(
        expect.arrayContaining([
          'uniq_circle_uid',
          'idx_circle_role',
          'uniq_circle_single_owner',
        ]),
      );

      const deviceIdx = await listCollectionIndexNames('devices');
      expect(deviceIdx).toEqual(
        expect.arrayContaining(['uniq_circle_fcmToken', 'idx_circle_uid', 'idx_fcmToken']),
      );

      const reminderIdx = await listCollectionIndexNames('reminder_items');
      expect(reminderIdx).toEqual(
        expect.arrayContaining(['uniq_circle_module_itemId', 'idx_circle_module_status']),
      );

      const completionIdx = await listCollectionIndexNames('completions');
      expect(completionIdx).toEqual(expect.arrayContaining(['uniq_circle_item_occurrence']));

      const jobIdx = await listCollectionIndexNames('jobs');
      expect(jobIdx).toEqual(
        expect.arrayContaining([
          'uniq_dedupeKey',
          'idx_poll_due',
          'idx_sent_fireAt',
          'idx_circle_item_state',
        ]),
      );
    });
  });

  describe('cascading deletion helpers', () => {
    it('deletes reminder-related jobs and completions', async () => {
      await ReminderItem.create({
        circleId: 'c1',
        module: 'medication',
        itemId: 'med-1',
        data: medicationData,
      });
      await Completion.create({
        circleId: 'c1',
        itemId: 'med-1',
        occurrenceKey: '2026-10-28-8-0',
        completed: true,
        updatedBy: 'owner',
      });
      await Job.create({
        circleId: 'c1',
        itemId: 'med-1',
        module: 'medication',
        occurrenceKey: '2026-10-28-8-0',
        type: 'med_due',
        fireAt: new Date(),
        audience: 'owner',
        dedupeKey: 'c1:med-1:2026-10-28-8-0:med_due',
        state: 'pending',
      });

      const counts = await deleteReminderCascade('c1', 'medication', 'med-1');
      expect(counts.reminderItems).toBe(1);
      expect(counts.completions).toBe(1);
      expect(counts.jobs).toBe(1);
    });

    it('removes member devices and cascades circle delete', async () => {
      await Circle.create({
        circleId: 'c1',
        ownerUid: 'owner',
        timezone: 'UTC',
      });
      await Member.create({
        circleId: 'c1',
        uid: 'member-1',
        role: 'member',
        displayName: 'M',
      });
      await Device.create({
        circleId: 'c1',
        uid: 'member-1',
        fcmToken: 'tok',
        platform: 'android',
      });

      await removeMemberFromCircle('c1', 'member-1');
      expect(await Member.countDocuments({ circleId: 'c1' })).toBe(0);
      expect(await Device.countDocuments({ circleId: 'c1' })).toBe(0);

      await Member.create({
        circleId: 'c1',
        uid: 'owner',
        role: 'owner',
        displayName: 'O',
      });
      await deleteCircleCascade('c1');
      expect(await Circle.countDocuments()).toBe(0);
    });
  });
});
