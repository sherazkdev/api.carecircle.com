import { Schema, model, type HydratedDocument, type InferSchemaType, type Model } from 'mongoose';
import { isValidIanaTimezone } from '../../shared/utils/timezone.js';

const circleSchema = new Schema(
  {
    circleId: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
    /**
     * Server-authoritative owner uid (C2).
     * Never set from an unverified client `role` claim.
     */
    ownerUid: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
    timezone: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (value: string) => isValidIanaTimezone(value),
        message: 'timezone must be a valid IANA zone (e.g. Asia/Karachi)',
      },
    },
  },
  {
    timestamps: true,
    collection: 'circles',
    versionKey: false,
  },
);

circleSchema.index({ circleId: 1 }, { unique: true, name: 'uniq_circleId' });
circleSchema.index({ ownerUid: 1 }, { name: 'idx_ownerUid' });

export type CircleAttrs = InferSchemaType<typeof circleSchema>;
export type CircleDocument = HydratedDocument<CircleAttrs>;
export type CircleModel = Model<CircleAttrs>;

export const Circle = model<CircleAttrs>('Circle', circleSchema);
