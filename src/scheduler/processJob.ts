import { getLogger } from '../config/logger.js';
import { Circle } from '../modules/circle/circle.model.js';
import { Completion } from '../modules/completion/completion.model.js';
import { removeInvalidFcmToken } from '../modules/device/device.service.js';
import { hhmmToParts } from '../modules/reminder/occurrence.utils.js';
import type {
  AppointmentData,
  MedicationData,
  TaskData,
} from '../modules/reminder/reminderData.schemas.js';
import { ReminderItem } from '../modules/reminder/reminderItem.model.js';
import type { ReminderModule, ReminderStatus } from '../shared/types/domain.js';
import {
  markJobFailed,
  markJobRetryOrFail,
  markJobSent,
  markJobSkipped,
} from './claimJobs.js';
import { getDeliveryPort } from './delivery.js';
import { evaluateJobEligibility } from './eligibility.js';
import { insertPlannedJobs } from './jobInsert.js';
import type { JobDocument } from './job.model.js';
import {
  planNextOccurrenceAfterDue,
  planNextSnoozeJob,
} from './planJobs.js';

function timeFromOccurrenceKey(occurrenceKey: string): string {
  const parts = occurrenceKey.split('-').map(Number);
  const hour = parts[3] ?? 0;
  const minute = parts[4] ?? 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

async function advanceAfterSuccessfulDue(job: JobDocument): Promise<void> {
  const circle = await Circle.findOne({ circleId: job.circleId }).lean();
  if (!circle) {
    return;
  }
  if (job.module === 'update') {
    return;
  }
  const module = job.module as ReminderModule;
  const reminder = await ReminderItem.findOne({
    circleId: job.circleId,
    module,
    itemId: job.itemId,
  }).lean();
  if (!reminder) {
    return;
  }

  const data = reminder.data as MedicationData | AppointmentData | TaskData;

  if (module === 'medication' && job.type === 'med_due') {
    const med = data as MedicationData;
    const completed = await Completion.findOne({
      circleId: job.circleId,
      itemId: job.itemId,
      occurrenceKey: job.occurrenceKey,
      completed: true,
    }).lean();
    if (!completed && med.snoozeMinutes > 0 && med.reminderEnabled) {
      const snooze = planNextSnoozeJob({
        circleId: job.circleId,
        itemId: job.itemId,
        timezone: circle.timezone,
        data: med,
        occurrenceKey: job.occurrenceKey,
        snoozeIndex: 1,
        fromFireAt: job.fireAt,
      });
      if (snooze) {
        await insertPlannedJobs([snooze]);
      }
    }

    const timeHhMm = timeFromOccurrenceKey(job.occurrenceKey);
    // Normalize to one of configured times if possible
    const matched = med.times.find((t) => {
      const p = hhmmToParts(t);
      const [ , , , h, m] = job.occurrenceKey.split('-').map(Number);
      return p.hour === h && p.minute === m;
    });
    const nextJobs = planNextOccurrenceAfterDue({
      circleId: job.circleId,
      itemId: job.itemId,
      module: 'medication',
      timezone: circle.timezone,
      data: med,
      completedOccurrenceKey: job.occurrenceKey,
      timeHhMm: matched ?? timeHhMm,
    });
    await insertPlannedJobs(nextJobs);
    return;
  }

  if (module === 'medication' && job.type === 'med_snooze') {
    const med = data as MedicationData;
    const hints = (job.payloadHints ?? {}) as { snoozeIndex?: number };
    const nextIndex = (hints.snoozeIndex ?? 1) + 1;
    const snooze = planNextSnoozeJob({
      circleId: job.circleId,
      itemId: job.itemId,
      timezone: circle.timezone,
      data: med,
      occurrenceKey: job.occurrenceKey,
      snoozeIndex: nextIndex,
      fromFireAt: job.fireAt,
    });
    if (snooze) {
      await insertPlannedJobs([snooze]);
    }
    return;
  }

  if ((module === 'task' && job.type === 'task_due') || (module === 'task' && job.type === 'task_missed')) {
    // Advance horizon after due (or missed if due was skipped) for recurring tasks.
    if (job.type === 'task_due') {
      const nextJobs = planNextOccurrenceAfterDue({
        circleId: job.circleId,
        itemId: job.itemId,
        module: 'task',
        timezone: circle.timezone,
        data: data as TaskData,
        status: (reminder.status as ReminderStatus) ?? 'active',
        completedOccurrenceKey: job.occurrenceKey,
      });
      await insertPlannedJobs(nextJobs);
    }
  }
}

export async function processClaimedJob(job: JobDocument): Promise<void> {
  const logger = getLogger();
  const jobId = String(job._id);

  const outcome = await evaluateJobEligibility(job);
  if (!outcome.eligible) {
    await markJobSkipped(jobId, outcome.reason);
    logger.info(
      { dedupeKey: job.dedupeKey, type: job.type, reason: outcome.reason },
      'job skipped',
    );
    // Still advance recurring horizon for due jobs that were skipped due to flags/prefs,
    // except when reminder is gone/completed occurrence.
    if (
      (job.type === 'med_due' || job.type === 'task_due') &&
      outcome.reason !== 'reminder missing' &&
      outcome.reason !== 'circle missing' &&
      outcome.reason !== 'medication occurrence completed' &&
      outcome.reason !== 'reminder not active'
    ) {
      // If disabled by reminderEnabled, still plan next occurrence so the stream continues.
      if (outcome.reason === 'item notification flags disable this type' || outcome.reason === 'no eligible recipients/devices') {
        await advanceAfterSuccessfulDue(job);
      }
    }
    // Completed occurrence: cancel further snooze by not scheduling; next occurrence already may exist from prior due.
    if (job.type === 'med_due' && outcome.reason === 'medication occurrence completed') {
      // Still need next occurrence stream
      await advanceAfterSuccessfulDue(job);
    }
    return;
  }

  const result = await getDeliveryPort().deliver(outcome.request);
  if (!result.ok) {
    if (result.invalidTokens?.length) {
      for (const token of result.invalidTokens) {
        await removeInvalidFcmToken(token);
      }
    }
    if (result.temporary) {
      const state = await markJobRetryOrFail(jobId, job.attempts, result.message);
      logger.warn(
        { dedupeKey: job.dedupeKey, type: job.type, state },
        'job delivery temporary failure',
      );
      return;
    }
    await markJobFailed(jobId, job.attempts + 1, result.message);
    logger.warn({ dedupeKey: job.dedupeKey, type: job.type }, 'job delivery permanent failure');
    return;
  }

  // Phase 6 Noop (pushed=false): advance schedule but never claim a real notification was sent.
  if (!result.pushed) {
    await markJobSkipped(jobId, result.reason);
    logger.info(
      { dedupeKey: job.dedupeKey, type: job.type, reason: result.reason },
      'job skipped (no push channel)',
    );
    await advanceAfterSuccessfulDue(job);
    return;
  }

  await markJobSent(jobId);
  logger.info({ dedupeKey: job.dedupeKey, type: job.type }, 'job delivered');
  await advanceAfterSuccessfulDue(job);
}
