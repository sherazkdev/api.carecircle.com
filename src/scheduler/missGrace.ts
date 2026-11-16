import { getEnv } from '../config/env.js';
import { Job } from './job.model.js';

const MISSED_TYPES = ['med_missed', 'appt_missed', 'task_missed'] as const;

/**
 * Pending missed jobs planned at the event time get pushed to event + grace once.
 * Jobs that already record missGraceMinutes are left alone, so restarts do not stack.
 */
export async function deferPendingMissedJobs(): Promise<number> {
  const graceMinutes = getEnv().MISS_GRACE_MINUTES;
  if (graceMinutes <= 0) {
    return 0;
  }

  const jobs = await Job.find({
    state: 'pending',
    type: { $in: [...MISSED_TYPES] },
  })
    .select({ fireAt: 1, payloadHints: 1 })
    .lean();

  let updated = 0;
  for (const job of jobs) {
    const hints = (job.payloadHints ?? {}) as { missGraceMinutes?: number };
    const applied = typeof hints.missGraceMinutes === 'number' ? hints.missGraceMinutes : 0;
    if (applied >= graceMinutes) {
      continue;
    }
    const fireAt = new Date(new Date(job.fireAt).getTime() + (graceMinutes - applied) * 60_000);
    const result = await Job.updateOne(
      { _id: job._id, state: 'pending' },
      { $set: { fireAt, 'payloadHints.missGraceMinutes': graceMinutes } },
    );
    updated += result.modifiedCount;
  }
  return updated;
}
