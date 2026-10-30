import type { NotificationType, ReminderModule } from '../../shared/types/domain.js';
import { DEFAULT_NOTIFICATION_TONE } from './templates.js';

export type ReminderFcmDataFields = {
  type: string;
  module: string;
  circleId: string;
  itemId: string;
  occurrenceKey: string;
  scheduledAt: string;
  title: string;
  body: string;
  tone: string;
};

export type UpdateFcmDataFields = {
  type: string;
  module: string;
  circleId: string;
  updateType: string;
  title: string;
  body: string;
  tone: string;
};

export type FcmDataFields = ReminderFcmDataFields | UpdateFcmDataFields;

/** Ensure every FCM data value is a string (Spec §10). */
export function assertStringDataFields(data: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string') {
      throw new Error(`FCM data field ${key} must be a string`);
    }
    out[key] = value;
  }
  return out;
}

export function buildReminderFcmData(input: {
  type: NotificationType;
  module: ReminderModule | 'update';
  circleId: string;
  itemId: string;
  occurrenceKey: string;
  scheduledAt: string;
  title: string;
  body: string;
  tone?: string | undefined;
}): ReminderFcmDataFields {
  return assertStringDataFields({
    type: input.type,
    module: input.module,
    circleId: input.circleId,
    itemId: input.itemId,
    occurrenceKey: input.occurrenceKey,
    scheduledAt: input.scheduledAt,
    title: input.title,
    body: input.body,
    tone: input.tone?.trim() || DEFAULT_NOTIFICATION_TONE,
  }) as ReminderFcmDataFields;
}

export function buildUpdateFcmData(input: {
  circleId: string;
  updateType: string;
  title: string;
  body: string;
  tone?: string | undefined;
}): UpdateFcmDataFields {
  return assertStringDataFields({
    type: 'update_new',
    module: 'update',
    circleId: input.circleId,
    updateType: input.updateType,
    title: input.title,
    body: input.body,
    tone: input.tone?.trim() || DEFAULT_NOTIFICATION_TONE,
  }) as UpdateFcmDataFields;
}

export type TokenMessage = {
  token: string;
  data: Record<string, string>;
  android: { priority: 'high' };
};

export function buildTokenMessage(token: string, data: FcmDataFields): TokenMessage {
  return {
    token,
    data: { ...data },
    android: { priority: 'high' },
  };
}
