import { z } from 'zod';
import { REMINDER_MODULES, REMINDER_STATUSES } from '../../shared/types/domain.js';
import { isValidOccurrenceKey } from '../../shared/utils/occurrenceKey.js';
import {
  appointmentDataSchema,
  medicationDataSchema,
  taskDataSchema,
} from './reminderData.schemas.js';

export const reminderPathParamsSchema = z.object({
  circleId: z.string().min(1),
  module: z.enum(REMINDER_MODULES),
  itemId: z.string().min(1),
});

export const medicationItemPathParamsSchema = z.object({
  circleId: z.string().min(1),
  itemId: z.string().min(1),
});

export const appointmentItemPathParamsSchema = medicationItemPathParamsSchema;
export const taskItemPathParamsSchema = medicationItemPathParamsSchema;

/** Upsert body is module-specific schedule data only — path supplies identity. */
export const reminderUpsertBodyByModule = {
  medication: medicationDataSchema,
  appointment: appointmentDataSchema,
  task: taskDataSchema,
} as const;

export const completionBodySchema = z.object({
  occurrenceKey: z
    .string()
    .min(1)
    .refine(isValidOccurrenceKey, 'occurrenceKey must match y-m-d-h-m without zero-padding'),
  completed: z.boolean(),
});

export const statusBodySchema = z.object({
  status: z.enum(REMINDER_STATUSES),
});

export type CompletionBody = z.infer<typeof completionBodySchema>;
export type StatusBody = z.infer<typeof statusBodySchema>;
