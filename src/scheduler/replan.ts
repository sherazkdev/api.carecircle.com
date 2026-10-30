import { Circle } from '../modules/circle/circle.model.js';
import type {
  AppointmentData,
  MedicationData,
  TaskData,
} from '../modules/reminder/reminderData.schemas.js';
import type { ReminderModule, ReminderStatus } from '../shared/types/domain.js';
import { deleteUnfinishedJobsForItem } from '../shared/db/cascades.js';
import { Job } from './job.model.js';
import { getClock } from './clock.js';
import { planAndInsertReminderJobs } from './planJobs.js';

export async function invalidateAndReplanReminder(input: {
  circleId: string;
  module: ReminderModule;
  itemId: string;
  data: MedicationData | AppointmentData | TaskData;
  status?: ReminderStatus | null;
}): Promise<number> {
  await deleteUnfinishedJobsForItem(input.circleId, input.itemId, input.module);
  const circle = await Circle.findOne({ circleId: input.circleId }).lean();
  if (!circle) {
    return 0;
  }
  const planInput: Parameters<typeof planAndInsertReminderJobs>[0] = {
    circleId: input.circleId,
    itemId: input.itemId,
    module: input.module,
    timezone: circle.timezone,
    data: input.data,
    now: getClock().now(),
  };
  if (input.status !== undefined) {
    planInput.status = input.status;
  }
  return planAndInsertReminderJobs(planInput);
}

/** Cancel unfinished jobs for a specific medication occurrence (completion). */
export async function cancelJobsForOccurrence(input: {
  circleId: string;
  itemId: string;
  occurrenceKey: string;
}): Promise<number> {
  const result = await Job.deleteMany({
    circleId: input.circleId,
    itemId: input.itemId,
    occurrenceKey: input.occurrenceKey,
    module: 'medication',
    state: { $in: ['pending', 'claimed', 'failed'] },
  });
  return result.deletedCount;
}
