import { Schema, model, type HydratedDocument, type InferSchemaType, type Model } from 'mongoose';
import {
  JOB_AUDIENCES,
  JOB_STATES,
  NOTIFICATION_TYPES,
  REMINDER_MODULES,
  type JobState,
  type NotificationType,
} from '../shared/types/domain.js';
import { buildJobDedupeKey } from '../shared/utils/dedupeKey.js';
import { isValidOccurrenceKey } from '../shared/utils/occurrenceKey.js';

const jobSchema = new Schema(
  {
    circleId: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
    itemId: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
    /** Convenience for loaders; update jobs may still set a module of `update` via payloadHints only. */
    module: {
      type: String,
      required: true,
      enum: [...REMINDER_MODULES, 'update'],
    },
    occurrenceKey: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator(this: { type?: NotificationType }, value: string) {
          if (this.type === 'update_new') {
            return value.length > 0;
          }
          return isValidOccurrenceKey(value);
        },
        message: 'occurrenceKey must match y-m-d-h-m (or non-empty for update_new)',
      },
    },
    type: {
      type: String,
      required: true,
      enum: NOTIFICATION_TYPES,
    },
    fireAt: {
      type: Date,
      required: true,
    },
    audience: {
      type: String,
      required: true,
      enum: JOB_AUDIENCES,
    },
    /**
     * Unique pending/historical identity.
     * Format: `{circleId}:{itemId}:{occurrenceKey}:{type}`
     */
    dedupeKey: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
    state: {
      type: String,
      required: true,
      enum: JOB_STATES,
      default: 'pending',
    },
    /** Spec §4 field; kept in sync with `state === 'sent'`. */
    sent: {
      type: Boolean,
      required: true,
      default: false,
    },
    attempts: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    nextAttemptAt: {
      type: Date,
      required: false,
    },
    claimedBy: {
      type: String,
      required: false,
      trim: true,
    },
    claimedAt: {
      type: Date,
      required: false,
    },
    /** Worker lease expiry for stale-claim recovery (operational extension). */
    leaseExpiresAt: {
      type: Date,
      required: false,
    },
    lastError: {
      type: String,
      required: false,
    },
    payloadHints: {
      type: Schema.Types.Mixed,
      required: false,
    },
  },
  {
    timestamps: true,
    collection: 'jobs',
    versionKey: false,
  },
);

jobSchema.index({ dedupeKey: 1 }, { unique: true, name: 'uniq_dedupeKey' });
jobSchema.index({ state: 1, fireAt: 1, nextAttemptAt: 1 }, { name: 'idx_poll_due' });
jobSchema.index({ sent: 1, fireAt: 1 }, { name: 'idx_sent_fireAt' });
jobSchema.index({ circleId: 1, itemId: 1, state: 1 }, { name: 'idx_circle_item_state' });
jobSchema.index({ claimedAt: 1 }, { name: 'idx_claimedAt', sparse: true });
jobSchema.index({ leaseExpiresAt: 1 }, { name: 'idx_leaseExpiresAt', sparse: true });

jobSchema.pre('validate', function jobValidate() {
  if (!this.dedupeKey) {
    this.dedupeKey = buildJobDedupeKey({
      circleId: this.circleId,
      itemId: this.itemId,
      occurrenceKey: this.occurrenceKey,
      type: this.type as NotificationType,
    });
  }

  const state = this.state as JobState;
  this.sent = state === 'sent';

  if (state === 'claimed') {
    if (!this.claimedBy || !this.claimedAt) {
      this.invalidate('claimedBy', 'claimed jobs require claimedBy and claimedAt');
    }
  }

  if (this.attempts < 0) {
    this.invalidate('attempts', 'attempts must be >= 0');
  }
});

export type JobAttrs = InferSchemaType<typeof jobSchema>;
export type JobDocument = HydratedDocument<JobAttrs>;
export type JobModelType = Model<JobAttrs>;

export const Job = model<JobAttrs>('Job', jobSchema);

export { buildJobDedupeKey };
