import { getEnv } from '../config/env.js';
import { getLogger } from '../config/logger.js';
import { getClock } from './clock.js';
import { Job, type JobDocument } from './job.model.js';

export function schedulerLeaseMs(): number {
  return Number(process.env.SCHEDULER_LEASE_MS ?? 60_000);
}

export function schedulerMaxAttempts(): number {
  return Number(process.env.SCHEDULER_MAX_ATTEMPTS ?? 3);
}

/**
 * Atomically claim the next due job (pending due, or expired lease).
 */
export async function claimNextJob(workerId: string, now = getClock().now()): Promise<JobDocument | null> {
  const leaseMs = schedulerLeaseMs();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);

  const claimed = await Job.findOneAndUpdate(
    {
      $or: [
        {
          state: 'pending',
          fireAt: { $lte: now },
          $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
        },
        {
          state: 'claimed',
          leaseExpiresAt: { $lte: now },
        },
      ],
    },
    {
      $set: {
        state: 'claimed',
        claimedBy: workerId,
        claimedAt: now,
        leaseExpiresAt,
        sent: false,
      },
    },
    {
      sort: { fireAt: 1 },
      returnDocument: 'after',
    },
  );

  if (claimed) {
    getLogger().debug(
      { jobDedupeKey: claimed.dedupeKey, type: claimed.type, workerId },
      'job claimed',
    );
  }
  return claimed;
}

export async function markJobSent(jobId: string): Promise<void> {
  await Job.findByIdAndUpdate(jobId, {
    $set: {
      state: 'sent',
      sent: true,
    },
    $unset: {
      claimedBy: 1,
      claimedAt: 1,
      leaseExpiresAt: 1,
      nextAttemptAt: 1,
      lastError: 1,
    },
  });
}

export async function markJobSkipped(jobId: string, reason: string): Promise<void> {
  await Job.findByIdAndUpdate(jobId, {
    $set: {
      state: 'skipped',
      sent: false,
      lastError: reason,
    },
    $unset: {
      claimedBy: 1,
      claimedAt: 1,
      leaseExpiresAt: 1,
      nextAttemptAt: 1,
    },
  });
}

export async function markJobFailed(jobId: string, attempts: number, message: string): Promise<void> {
  await Job.findByIdAndUpdate(jobId, {
    $set: {
      state: 'failed',
      sent: false,
      attempts,
      lastError: message,
    },
    $unset: {
      claimedBy: 1,
      claimedAt: 1,
      leaseExpiresAt: 1,
      nextAttemptAt: 1,
    },
  });
}

export async function markJobRetryOrFail(
  jobId: string,
  attempts: number,
  message: string,
  now = getClock().now(),
): Promise<'pending' | 'failed'> {
  const max = schedulerMaxAttempts();
  const nextAttempts = attempts + 1;
  if (nextAttempts >= max) {
    await markJobFailed(jobId, nextAttempts, message);
    return 'failed';
  }

  const backoffMs = Math.min(60_000, 2 ** nextAttempts * 1000);
  await Job.findByIdAndUpdate(jobId, {
    $set: {
      state: 'pending',
      sent: false,
      attempts: nextAttempts,
      nextAttemptAt: new Date(now.getTime() + backoffMs),
      lastError: message,
    },
    $unset: {
      claimedBy: 1,
      claimedAt: 1,
      leaseExpiresAt: 1,
    },
  });
  return 'pending';
}

/** Test/ops helper — unused env import kept for future grace wiring */
export function missGraceMinutes(): number {
  return getEnv().MISS_GRACE_MINUTES;
}
