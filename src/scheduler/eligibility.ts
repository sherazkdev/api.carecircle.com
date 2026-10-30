import { Circle } from '../modules/circle/circle.model.js';
import { Completion } from '../modules/completion/completion.model.js';
import { Device } from '../modules/device/device.model.js';
import { Member } from '../modules/member/member.model.js';
import type {
  AppointmentData,
  MedicationData,
  TaskData,
} from '../modules/reminder/reminderData.schemas.js';
import { ReminderItem } from '../modules/reminder/reminderItem.model.js';
import type { NotificationType, ReminderModule } from '../shared/types/domain.js';
import { type DeliveryRecipient, type DeliveryRequest } from './delivery.js';
import type { JobAttrs } from './job.model.js';
import { localPartsFromOccurrenceKey } from './timeLocal.js';

export type EligibilityOutcome =
  | { eligible: true; request: DeliveryRequest }
  | { eligible: false; reason: string };

function modulePrefKey(module: ReminderModule): 'medication' | 'appointment' | 'task' {
  return module;
}

function itemFlagsAllow(
  type: NotificationType,
  data: MedicationData | AppointmentData | TaskData,
): boolean {
  const reminderEnabled = data.reminderEnabled;
  const notifyFamilyOnMiss = data.notifyFamilyOnMiss;

  if (type.endsWith('_before') || type.endsWith('_due') || type === 'med_snooze') {
    return reminderEnabled;
  }
  if (type.endsWith('_missed')) {
    return notifyFamilyOnMiss;
  }
  return true;
}

/**
 * Send-time eligibility (R32). Recipients are resolved here, not at schedule time.
 *
 * Race note: a completion/preference change can still land after this check and before
 * Phase 7 FCM acknowledgement — delivery remains at-least-once.
 */
export async function evaluateJobEligibility(
  job: JobAttrs & { _id?: { toString(): string } },
): Promise<EligibilityOutcome> {
  const jobId = job._id?.toString?.() ?? 'unknown';
  const module = job.module as ReminderModule | 'update';
  if (module === 'update') {
    return { eligible: false, reason: 'update jobs are handled inline in Phase 8' };
  }

  const circle = await Circle.findOne({ circleId: job.circleId }).lean();
  if (!circle) {
    return { eligible: false, reason: 'circle missing' };
  }

  const reminder = await ReminderItem.findOne({
    circleId: job.circleId,
    module,
    itemId: job.itemId,
  }).lean();
  if (!reminder) {
    return { eligible: false, reason: 'reminder missing' };
  }

  const data = reminder.data as MedicationData | AppointmentData | TaskData;
  const type = job.type as NotificationType;

  if (!itemFlagsAllow(type, data)) {
    return { eligible: false, reason: 'item notification flags disable this type' };
  }

  if (module === 'medication') {
    const completion = await Completion.findOne({
      circleId: job.circleId,
      itemId: job.itemId,
      occurrenceKey: job.occurrenceKey,
      completed: true,
    }).lean();
    if (completion) {
      return { eligible: false, reason: 'medication occurrence completed' };
    }
  } else {
    if (reminder.status !== 'active') {
      return { eligible: false, reason: 'reminder not active' };
    }
  }

  const scheduledLocal = localPartsFromOccurrenceKey(job.occurrenceKey, circle.timezone);
  const scheduledAtIso = scheduledLocal?.toUTC().toISO() ?? job.fireAt.toISOString();

  const members = await Member.find({ circleId: job.circleId }).lean();
  let candidateUids: string[] = [];

  if (job.audience === 'owner') {
    candidateUids = [circle.ownerUid];
  } else if (job.audience === 'family') {
    candidateUids = members.filter((m) => m.uid !== circle.ownerUid).map((m) => m.uid);
  } else {
    candidateUids = members.map((m) => m.uid);
  }

  const prefKey = modulePrefKey(module);
  const recipients: DeliveryRecipient[] = [];

  for (const uid of candidateUids) {
    const member = members.find((m) => m.uid === uid);
    if (!member) {
      continue;
    }
    if (!member.prefs[prefKey]) {
      continue;
    }
    const devices = await Device.find({ circleId: job.circleId, uid }).lean();
    for (const device of devices) {
      recipients.push({
        uid,
        fcmToken: device.fcmToken,
        platform: device.platform,
      });
    }
  }

  if (recipients.length === 0) {
    return { eligible: false, reason: 'no eligible recipients/devices' };
  }

  const request: DeliveryRequest = {
    jobId,
    circleId: job.circleId,
    itemId: job.itemId,
    module,
    type,
    occurrenceKey: job.occurrenceKey,
    scheduledAtIso: scheduledAtIso ?? new Date(job.fireAt).toISOString(),
    audience: job.audience,
    timezone: circle.timezone,
    recipients,
  };
  if (typeof (data as { reminderTone?: string }).reminderTone === 'string') {
    request.tone = (data as { reminderTone: string }).reminderTone;
  }
  if (typeof (data as { title?: string }).title === 'string') {
    request.titleHint = (data as { title: string }).title;
  }
  const hints = (job.payloadHints ?? {}) as { leadTimeMinutes?: number };
  if (typeof hints.leadTimeMinutes === 'number') {
    request.leadTimeMinutes = hints.leadTimeMinutes;
  } else if (typeof (data as { leadTimeMinutes?: number }).leadTimeMinutes === 'number') {
    request.leadTimeMinutes = (data as { leadTimeMinutes: number }).leadTimeMinutes;
  }

  return {
    eligible: true,
    request,
  };
}
