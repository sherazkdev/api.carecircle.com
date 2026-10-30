import { Schema, model, type HydratedDocument, type InferSchemaType, type Model } from 'mongoose';
import { DEVICE_PLATFORMS } from '../../shared/types/domain.js';

const deviceSchema = new Schema(
  {
    circleId: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
    uid: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
    /** Device identity (R2). */
    fcmToken: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
    platform: {
      type: String,
      required: true,
      enum: DEVICE_PLATFORMS,
    },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    collection: 'devices',
    versionKey: false,
  },
);

/** One token registration per circle. */
deviceSchema.index({ circleId: 1, fcmToken: 1 }, { unique: true, name: 'uniq_circle_fcmToken' });
/** Fan-out by member. */
deviceSchema.index({ circleId: 1, uid: 1 }, { name: 'idx_circle_uid' });
/**
 * Global token lookup for R4 reassignment across circles/accounts.
 * Not unique globally: same physical token may exist once per circle for the same uid
 * after a multi-circle register; reassignment deletes other uids' rows first.
 */
deviceSchema.index({ fcmToken: 1 }, { name: 'idx_fcmToken' });

export type DeviceAttrs = InferSchemaType<typeof deviceSchema>;
export type DeviceDocument = HydratedDocument<DeviceAttrs>;
export type DeviceModelType = Model<DeviceAttrs>;

type DeviceModelWithHelpers = DeviceModelType & {
  /**
   * Spec R4: move token ownership to `newUid` by deleting rows owned by any other uid,
   * then upserting for each target circle (caller supplies circle upsert separately).
   * This helper only performs the cross-uid purge.
   */
  releaseTokenFromOtherUsers(fcmToken: string, newUid: string): Promise<{ deletedCount: number }>;
};

deviceSchema.statics.releaseTokenFromOtherUsers = async function releaseTokenFromOtherUsers(
  this: DeviceModelType,
  fcmToken: string,
  newUid: string,
): Promise<{ deletedCount: number }> {
  const result = await this.deleteMany({ fcmToken, uid: { $ne: newUid } });
  return { deletedCount: result.deletedCount };
};

export const Device = model<DeviceAttrs, DeviceModelWithHelpers>('Device', deviceSchema);
