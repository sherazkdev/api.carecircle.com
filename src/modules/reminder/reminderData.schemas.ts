import { z } from 'zod';
import {
  LEAD_TIME_MINUTES,
  MEDICATION_SCHEDULE_MODES,
  SNOOZE_MINUTES,
  TASK_REPEAT_MODES,
} from '../../shared/types/domain.js';

const timeHhMm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:mm (24-hour)');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

const weekday = z.number().int().min(0).max(6);

const leadTimeMinutes = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(15),
  z.literal(30),
  z.literal(60),
]);

const snoozeMinutes = z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(15)]);

const commonToggles = {
  reminderEnabled: z.boolean(),
  notifyFamilyOnMiss: z.boolean(),
  leadTimeMinutes,
  reminderTone: z.string().min(1),
};

export const medicationDataSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().min(1),
    scheduleMode: z.enum(MEDICATION_SCHEDULE_MODES),
    repeatDays: z.array(weekday).optional(),
    times: z.array(timeHhMm).min(1),
    startDate: isoDate,
    snoozeMinutes,
    ...commonToggles,
  })
  .superRefine((data, ctx) => {
    if (data.scheduleMode === 'specificDays') {
      if (!data.repeatDays || data.repeatDays.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'repeatDays required and non-empty when scheduleMode is specificDays',
          path: ['repeatDays'],
        });
      }
    }
    const uniqueTimes = new Set(data.times);
    if (uniqueTimes.size !== data.times.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'times must be unique',
        path: ['times'],
      });
    }
  });

export const appointmentDataSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  startsAt: z.string().datetime({ offset: true }),
  ...commonToggles,
});

export const taskDataSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().min(1),
    repeatMode: z.enum(TASK_REPEAT_MODES),
    repeatDays: z.array(weekday).optional(),
    date: isoDate,
    time: timeHhMm,
    ...commonToggles,
  })
  .superRefine((data, ctx) => {
    if (data.repeatMode === 'custom') {
      if (!data.repeatDays || data.repeatDays.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'repeatDays required and non-empty when repeatMode is custom',
          path: ['repeatDays'],
        });
      }
    }
  });

export type MedicationData = z.infer<typeof medicationDataSchema>;
export type AppointmentData = z.infer<typeof appointmentDataSchema>;
export type TaskData = z.infer<typeof taskDataSchema>;
export type ReminderData = MedicationData | AppointmentData | TaskData;

export function parseReminderData(
  module: 'medication' | 'appointment' | 'task',
  data: unknown,
): ReminderData {
  switch (module) {
    case 'medication':
      return medicationDataSchema.parse(data);
    case 'appointment':
      return appointmentDataSchema.parse(data);
    case 'task':
      return taskDataSchema.parse(data);
    default: {
      const _exhaustive: never = module;
      throw new Error(`Unsupported module: ${String(_exhaustive)}`);
    }
  }
}

/** Re-export enums used by tests / callers */
export { LEAD_TIME_MINUTES, SNOOZE_MINUTES };
