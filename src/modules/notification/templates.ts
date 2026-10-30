import { DateTime } from 'luxon';
import type { NotificationType } from '../../shared/types/domain.js';

export const DEFAULT_NOTIFICATION_TONE = 'gentle_chime';

export type ReminderTemplateInput = {
  type: Exclude<NotificationType, 'update_new'>;
  itemTitle: string;
  /** Instant of the scheduled occurrence (UTC or zoned). */
  scheduledAt: Date;
  timezone: string;
  leadTimeMinutes?: number;
};

export type UpdateTemplateInput = {
  type: 'update_new';
  senderDisplayName: string;
  notes: string;
};

export type TemplateInput = ReminderTemplateInput | UpdateTemplateInput;

export type RenderedNotification = {
  title: string;
  body: string;
};

/** Spec §9: 12-hour clock in circle timezone, e.g. `08:00 AM`. */
export function formatCircleTime(scheduledAt: Date, timezone: string): string {
  const dt = DateTime.fromJSDate(scheduledAt, { zone: 'utc' }).setZone(timezone);
  if (!dt.isValid) {
    return DateTime.fromJSDate(scheduledAt).toFormat('hh:mm a');
  }
  return dt.toFormat('hh:mm a');
}

/** Spec §9: `10 min` for 5–45; `1 hour` for 60. */
export function formatLeadTime(leadTimeMinutes: number): string {
  if (leadTimeMinutes === 60) {
    return '1 hour';
  }
  return `${leadTimeMinutes} min`;
}

/** Spec §9: truncate notes to 100 characters with `...` when longer. */
export function truncateNotes(notes: string, max = 100): string {
  if (notes.length <= max) {
    return notes;
  }
  return `${notes.slice(0, max)}...`;
}

function requireLead(leadTimeMinutes: number | undefined, type: string): number {
  if (leadTimeMinutes === undefined || leadTimeMinutes <= 0) {
    throw new Error(`leadTimeMinutes is required for template type ${type}`);
  }
  return leadTimeMinutes;
}

/**
 * Spec v5 Section 9 — server-owned titles/bodies. Never trust client-supplied copy.
 */
export function renderNotificationTemplate(input: TemplateInput): RenderedNotification {
  if (input.type === 'update_new') {
    const sender = input.senderDisplayName.trim() || 'Someone';
    return {
      title: `${sender} shared an update`,
      body: truncateNotes(input.notes),
    };
  }

  const time = formatCircleTime(input.scheduledAt, input.timezone);
  const title = input.itemTitle;

  switch (input.type) {
    case 'med_before': {
      const lead = formatLeadTime(requireLead(input.leadTimeMinutes, input.type));
      return {
        title: 'Medication reminder',
        body: `${title} is due at ${time} (in ${lead})`,
      };
    }
    case 'med_due':
      return {
        title: 'Time for your medicine',
        body: `Take ${title} now (${time})`,
      };
    case 'med_missed':
      return {
        title: 'Dose missed',
        body: `The ${title} dose scheduled at ${time} was missed`,
      };
    case 'med_snooze':
      return {
        title: 'Dose still pending',
        body: `${title} was due at ${time}. Please mark it as taken`,
      };
    case 'appt_before': {
      const lead = formatLeadTime(requireLead(input.leadTimeMinutes, input.type));
      return {
        title: 'Upcoming appointment',
        body: `${title} at ${time} (in ${lead})`,
      };
    }
    case 'appt_due':
      return {
        title: 'Appointment time',
        body: `${title} is starting now (${time})`,
      };
    case 'appt_missed':
      return {
        title: 'Appointment alert',
        body: `${title} scheduled at ${time} is not marked as completed`,
      };
    case 'task_before': {
      const lead = formatLeadTime(requireLead(input.leadTimeMinutes, input.type));
      return {
        title: 'Task reminder',
        body: `${title} is due at ${time} (in ${lead})`,
      };
    }
    case 'task_due':
      return {
        title: 'Task due now',
        body: `${title} is due now (${time})`,
      };
    case 'task_missed':
      return {
        title: 'Task not completed',
        body: `${title} was due at ${time} and is not marked as completed`,
      };
  }
}
