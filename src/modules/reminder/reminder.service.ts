import {
  deleteReminderCascade,
} from '../../shared/db/cascades.js';
import { badRequest, notFound } from '../../shared/errors/AppError.js';
import type { ReminderModule, ReminderStatus } from '../../shared/types/domain.js';
import { getClock } from '../../scheduler/clock.js';
import { insertPlannedJobs } from '../../scheduler/jobInsert.js';
import { planNextSnoozeJob } from '../../scheduler/planJobs.js';
import {
  cancelJobsForOccurrence,
  invalidateAndReplanReminder,
} from '../../scheduler/replan.js';
import { Circle } from '../circle/circle.model.js';
import { Completion } from '../completion/completion.model.js';
import { isMedicationOccurrenceValid } from './occurrence.utils.js';
import {
  parseReminderData,
  type AppointmentData,
  type MedicationData,
  type ReminderData,
  type TaskData,
} from './reminderData.schemas.js';
import { ReminderItem } from './reminderItem.model.js';

function stripIdentityFields(body: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...body };
  delete clone['circleId'];
  delete clone['module'];
  delete clone['itemId'];
  delete clone['status'];
  return clone;
}

export async function upsertReminder(input: {
  circleId: string;
  module: ReminderModule;
  itemId: string;
  body: unknown;
}) {
  if (typeof input.body !== 'object' || input.body === null || Array.isArray(input.body)) {
    throw badRequest('Request body must be an object');
  }

  const raw = stripIdentityFields(input.body as Record<string, unknown>);
  const data = parseReminderData(input.module, raw);

  const existing = await ReminderItem.findOne({
    circleId: input.circleId,
    module: input.module,
    itemId: input.itemId,
  }).lean();

  let status: ReminderStatus | undefined;
  if (input.module === 'appointment' || input.module === 'task') {
    status = (existing?.status as ReminderStatus | undefined) ?? 'active';
  }

  const $set: Record<string, unknown> = { data };
  if (status !== undefined) {
    $set['status'] = status;
  }
  const update: Record<string, unknown> = { $set };
  if (input.module === 'medication') {
    update['$unset'] = { status: 1 };
  }

  const updated = await ReminderItem.findOneAndUpdate(
    {
      circleId: input.circleId,
      module: input.module,
      itemId: input.itemId,
    },
    update,
    {
      upsert: true,
      returnDocument: 'after',
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  );

  if (!updated) {
    throw notFound('Reminder not found after upsert');
  }

  const planned = await invalidateAndReplanReminder({
    circleId: input.circleId,
    module: input.module,
    itemId: input.itemId,
    data: updated.data as ReminderData,
    status: (updated.status as ReminderStatus | undefined) ?? status ?? null,
  });

  return {
    circleId: updated.circleId,
    module: updated.module,
    itemId: updated.itemId,
    data: updated.data as ReminderData,
    status: updated.status ?? null,
    created: !existing,
    jobsPlanned: planned,
  };
}

export async function deleteReminder(input: {
  circleId: string;
  module: ReminderModule;
  itemId: string;
}) {
  const counts = await deleteReminderCascade(input.circleId, input.module, input.itemId);
  return {
    circleId: input.circleId,
    module: input.module,
    itemId: input.itemId,
    deleted: counts['reminderItems'] === 1,
    cleanup: {
      reminderItems: counts['reminderItems'] ?? 0,
      completions: counts['completions'] ?? 0,
      jobs: counts['jobs'] ?? 0,
    },
  };
}

export async function setMedicationCompletion(input: {
  circleId: string;
  itemId: string;
  uid: string;
  occurrenceKey: string;
  completed: boolean;
}) {
  const reminder = await ReminderItem.findOne({
    circleId: input.circleId,
    module: 'medication',
    itemId: input.itemId,
  }).lean();

  if (!reminder) {
    throw notFound('Medication reminder not found');
  }

  const data = reminder.data as MedicationData;
  const validity = isMedicationOccurrenceValid(data, input.occurrenceKey);
  if (!validity.ok) {
    throw badRequest(validity.reason);
  }

  const completion = await Completion.findOneAndUpdate(
    {
      circleId: input.circleId,
      itemId: input.itemId,
      occurrenceKey: input.occurrenceKey,
    },
    {
      $set: {
        completed: input.completed,
        updatedBy: input.uid,
      },
    },
    {
      upsert: true,
      returnDocument: 'after',
      runValidators: true,
    },
  );

  if (!completion) {
    throw notFound('Completion not found after upsert');
  }

  if (input.completed) {
    await cancelJobsForOccurrence({
      circleId: input.circleId,
      itemId: input.itemId,
      occurrenceKey: input.occurrenceKey,
    });
  } else {
    // Undo: never replay past before/due/missed; may schedule future snooze only if still in window.
    await cancelJobsForOccurrence({
      circleId: input.circleId,
      itemId: input.itemId,
      occurrenceKey: input.occurrenceKey,
    });
    const circle = await Circle.findOne({ circleId: input.circleId }).lean();
    if (circle && data.snoozeMinutes > 0 && data.reminderEnabled) {
      const snooze = planNextSnoozeJob({
        circleId: input.circleId,
        itemId: input.itemId,
        timezone: circle.timezone,
        data,
        occurrenceKey: input.occurrenceKey,
        snoozeIndex: 1,
        fromFireAt: getClock().now(),
      });
      if (snooze && snooze.fireAt.getTime() > getClock().now().getTime()) {
        await insertPlannedJobs([snooze]);
      }
    }
  }

  return {
    circleId: completion.circleId,
    itemId: completion.itemId,
    occurrenceKey: completion.occurrenceKey,
    completed: completion.completed,
    updatedBy: completion.updatedBy,
    updatedAt: completion.updatedAt,
  };
}

export async function setAppointmentStatus(input: {
  circleId: string;
  itemId: string;
  status: ReminderStatus;
}) {
  return setModuleStatus({
    circleId: input.circleId,
    module: 'appointment',
    itemId: input.itemId,
    status: input.status,
  });
}

export async function setTaskStatus(input: {
  circleId: string;
  itemId: string;
  status: ReminderStatus;
}) {
  return setModuleStatus({
    circleId: input.circleId,
    module: 'task',
    itemId: input.itemId,
    status: input.status,
  });
}

async function setModuleStatus(input: {
  circleId: string;
  module: 'appointment' | 'task';
  itemId: string;
  status: ReminderStatus;
}) {
  const existing = await ReminderItem.findOne({
    circleId: input.circleId,
    module: input.module,
    itemId: input.itemId,
  }).lean();

  if (!existing) {
    throw notFound(`${input.module} reminder not found`);
  }

  const updated = await ReminderItem.findOneAndUpdate(
    {
      circleId: input.circleId,
      module: input.module,
      itemId: input.itemId,
    },
    { $set: { status: input.status } },
    { returnDocument: 'after', runValidators: true },
  );

  if (!updated) {
    throw notFound(`${input.module} reminder not found`);
  }

  const data = updated.data as AppointmentData | TaskData;
  if (input.status === 'completed') {
    await invalidateAndReplanReminder({
      circleId: input.circleId,
      module: input.module,
      itemId: input.itemId,
      data,
      status: 'completed',
    });
  } else {
    await invalidateAndReplanReminder({
      circleId: input.circleId,
      module: input.module,
      itemId: input.itemId,
      data,
      status: 'active',
    });
  }

  return {
    circleId: updated.circleId,
    module: updated.module,
    itemId: updated.itemId,
    status: updated.status as ReminderStatus,
    data,
  };
}
