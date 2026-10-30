import { Schema, model, type HydratedDocument, type InferSchemaType, type Model } from 'mongoose';

export const UPDATE_DELIVERY_STATUSES = [
  'pending',
  'sent',
  'failed_temp',
  'failed_perm',
  'no_recipients',
] as const;
export type UpdateDeliveryStatus = (typeof UPDATE_DELIVERY_STATUSES)[number];

/**
 * Durable update event / outbox for idempotent share + partial FCM retry.
 * `updateId` is also used as DeliveryAttempt.jobId.
 */
const updateOutboxSchema = new Schema(
  {
    updateId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    circleId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    senderUid: {
      type: String,
      required: true,
      trim: true,
    },
    /** Snapshot from Member.displayName at share time (C3). */
    senderDisplayName: {
      type: String,
      required: true,
      trim: true,
    },
    updateType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
    },
    notes: {
      type: String,
      required: true,
      maxlength: 2000,
    },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 128,
    },
    deliveryStatus: {
      type: String,
      required: true,
      enum: UPDATE_DELIVERY_STATUSES,
      default: 'pending',
    },
    lastError: {
      type: String,
      trim: true,
    },
    recipientDeviceCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    collection: 'update_outbox',
    versionKey: false,
  },
);

updateOutboxSchema.index(
  { circleId: 1, idempotencyKey: 1 },
  { unique: true, name: 'uniq_circle_update_idempotency' },
);

export type UpdateOutboxAttrs = InferSchemaType<typeof updateOutboxSchema>;
export type UpdateOutboxDocument = HydratedDocument<UpdateOutboxAttrs>;
export type UpdateOutboxModelType = Model<UpdateOutboxAttrs>;

export const UpdateOutbox = model<UpdateOutboxAttrs>('UpdateOutbox', updateOutboxSchema);
