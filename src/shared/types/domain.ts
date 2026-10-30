/** Shared domain enums and aliases — Spec v5 + approved operational extensions. */

export const MEMBER_ROLES = ['owner', 'member'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const REMINDER_MODULES = ['medication', 'appointment', 'task'] as const;
export type ReminderModule = (typeof REMINDER_MODULES)[number];

export const REMINDER_STATUSES = ['active', 'completed'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const DEVICE_PLATFORMS = ['android', 'ios'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const LEAD_TIME_MINUTES = [5, 10, 15, 30, 60] as const;
export type LeadTimeMinutes = (typeof LEAD_TIME_MINUTES)[number];

export const SNOOZE_MINUTES = [0, 5, 10, 15] as const;
export type SnoozeMinutes = (typeof SNOOZE_MINUTES)[number];

export const MEDICATION_SCHEDULE_MODES = ['daily', 'specificDays'] as const;
export type MedicationScheduleMode = (typeof MEDICATION_SCHEDULE_MODES)[number];

export const TASK_REPEAT_MODES = ['doesNotRepeat', 'daily', 'custom'] as const;
export type TaskRepeatMode = (typeof TASK_REPEAT_MODES)[number];

export const NOTIFICATION_TYPES = [
  'med_before',
  'med_due',
  'med_missed',
  'med_snooze',
  'appt_before',
  'appt_due',
  'appt_missed',
  'task_before',
  'task_due',
  'task_missed',
  'update_new',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const JOB_AUDIENCES = ['owner', 'family', 'members_except_sender'] as const;
export type JobAudience = (typeof JOB_AUDIENCES)[number];

export const JOB_STATES = ['pending', 'claimed', 'sent', 'skipped', 'failed'] as const;
export type JobState = (typeof JOB_STATES)[number];

export type MemberPrefs = {
  medication: boolean;
  appointment: boolean;
  task: boolean;
  updates: boolean;
};

export const DEFAULT_MEMBER_PREFS: MemberPrefs = {
  medication: true,
  appointment: true,
  task: true,
  updates: true,
};
