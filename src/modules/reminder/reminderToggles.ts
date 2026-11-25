import type { AppointmentData, MedicationData, ReminderData, TaskData } from './reminderData.schemas.js';

type Toggled = Pick<MedicationData, 'reminderEnabled' | 'remindMeFamilyBefore'>;

/** Early reminder toggle; older clients only sent reminderEnabled. */
export function isRemindMeFamilyBeforeEnabled(data: Toggled): boolean {
  return data.remindMeFamilyBefore ?? data.reminderEnabled;
}

export function normalizeReminderData<T extends ReminderData>(data: T): T {
  return {
    ...data,
    remindMeFamilyBefore: isRemindMeFamilyBeforeEnabled(data),
  };
}
