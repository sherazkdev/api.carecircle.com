import type { JobAudience, NotificationType, ReminderModule } from '../shared/types/domain.js';
import { buildJobDedupeKey } from '../shared/utils/dedupeKey.js';
import { Job } from './job.model.js';

export type PlannedJob = {
  circleId: string;
  itemId: string;
  module: ReminderModule | 'update';
  occurrenceKey: string;
  type: NotificationType;
  fireAt: Date;
  audience: JobAudience;
  dedupeSuffix?: string;
  payloadHints?: Record<string, unknown>;
};

/**
 * Insert planned jobs idempotently. Skips if dedupeKey already exists
 * (including terminal sent/skipped/failed — never recreates history).
 */
export async function insertPlannedJobs(jobs: PlannedJob[]): Promise<number> {
  let inserted = 0;
  for (const job of jobs) {
    const dedupeKey = buildJobDedupeKey({
      circleId: job.circleId,
      itemId: job.itemId,
      occurrenceKey: job.occurrenceKey,
      type: job.type,
      ...(job.dedupeSuffix !== undefined ? { suffix: job.dedupeSuffix } : {}),
    });

    const existing = await Job.findOne({ dedupeKey }).lean();
    if (existing) {
      continue;
    }

    try {
      await Job.create({
        circleId: job.circleId,
        itemId: job.itemId,
        module: job.module,
        occurrenceKey: job.occurrenceKey,
        type: job.type,
        fireAt: job.fireAt,
        audience: job.audience,
        dedupeKey,
        state: 'pending',
        sent: false,
        attempts: 0,
        ...(job.payloadHints !== undefined ? { payloadHints: job.payloadHints } : {}),
      });
      inserted += 1;
    } catch (err) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: number }).code === 11000
      ) {
        continue;
      }
      throw err;
    }
  }
  return inserted;
}
