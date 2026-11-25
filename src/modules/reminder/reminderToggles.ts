import type { MedicationData, ReminderData } from './reminderData.schemas.js';

type Toggled = Pick<MedicationData, 'reminderEnabled' | 'remindFamilyBefore'>;

/** Early reminder toggle; older clients only sent reminderEnabled. */
export function isRemindFamilyBeforeEnabled(data: Toggled): boolean {
  return data.remindFamilyBefore ?? data.reminderEnabled;
}

export function normalizeReminderData<T extends ReminderData>(data: T): T {
  return {
    ...data,
    remindFamilyBefore: isRemindFamilyBeforeEnabled(data),
  };
}