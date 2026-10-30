import { Schema, model, type HydratedDocument, type InferSchemaType, type Model } from 'mongoose';
import { ZodError } from 'zod';
import { REMINDER_MODULES, REMINDER_STATUSES } from '../../shared/types/domain.js';
import { parseReminderData } from './reminderData.schemas.js';

const reminderItemSchema = new Schema(
  {
    circleId: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
    module: {
      type: String,
      required: true,
      enum: REMINDER_MODULES,
    },
    itemId: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
    /** Normalized upsert payload (module-specific). */
    data: {
      type: Schema.Types.Mixed,
      required: true,
    },
    /**
     * Appointment/task lifecycle status.
     * Medications use Completion documents instead — status must be unset for medication.
     */
    status: {
      type: String,
      enum: REMINDER_STATUSES,
      required: false,
    },
  },
  {
    timestamps: true,
    collection: 'reminder_items',
    versionKey: false,
  },
);

reminderItemSchema.index(
  { circleId: 1, module: 1, itemId: 1 },
  { unique: true, name: 'uniq_circle_module_itemId' },
);
reminderItemSchema.index({ circleId: 1, module: 1, status: 1 }, { name: 'idx_circle_module_status' });

reminderItemSchema.pre('validate', function reminderItemValidate() {
  try {
    const module = this.module as 'medication' | 'appointment' | 'task';
    const normalized = parseReminderData(module, this.data);
    this.data = normalized;

    if (module === 'medication') {
      if (this.status != null) {
        this.invalidate(
          'status',
          'medication reminders must not set status; use Completion documents',
        );
      }
    } else if (this.status !== 'active' && this.status !== 'completed') {
      this.invalidate('status', 'appointment and task reminders require status active|completed');
    }
  } catch (err) {
    if (err instanceof ZodError) {
      const message = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      this.invalidate('data', message);
      return;
    }
    throw err instanceof Error ? err : new Error('Invalid reminder data');
  }
});

export type ReminderItemAttrs = InferSchemaType<typeof reminderItemSchema>;
export type ReminderItemDocument = HydratedDocument<ReminderItemAttrs>;
export type ReminderItemModelType = Model<ReminderItemAttrs>;

export const ReminderItem = model<ReminderItemAttrs>('ReminderItem', reminderItemSchema);
