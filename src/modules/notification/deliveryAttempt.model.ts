import { createHash } from 'node:crypto';
import { Schema, model, type HydratedDocument, type InferSchemaType, type Model } from 'mongoose';

/**
 * Per-device delivery ledger for partial-retry safety.
 * Stores a token fingerprint (SHA-256 hex), never logs the raw FCM token.
 */
export function hashFcmToken(fcmToken: string): string {
  return createHash('sha256').update(fcmToken).digest('hex');
}

const deliveryAttemptSchema = new Schema(
  {
    jobId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    circleId: {
      type: String,
      required: true,
      trim: true,
    },
    tokenHash: {
      type: String,
      required: true,
      trim: true,
      minlength: 64,
      maxlength: 64,
    },
    uid: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['sent', 'failed_temp', 'failed_perm'],
    },
    /** Firebase message id when accepted — never a device token. */
    fcmMessageId: {
      type: String,
      trim: true,
    },
    errorCode: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    collection: 'delivery_attempts',
    versionKey: false,
  },
);

deliveryAttemptSchema.index(
  { jobId: 1, tokenHash: 1 },
  { unique: true, name: 'uniq_job_token_hash' },
);

export type DeliveryAttemptAttrs = InferSchemaType<typeof deliveryAttemptSchema>;
export type DeliveryAttemptDocument = HydratedDocument<DeliveryAttemptAttrs>;
export type DeliveryAttemptModelType = Model<DeliveryAttemptAttrs>;

export const DeliveryAttempt = model<DeliveryAttemptAttrs>(
  'DeliveryAttempt',
  deliveryAttemptSchema,
);
