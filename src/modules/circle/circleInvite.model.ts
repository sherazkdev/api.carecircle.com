import { Schema, model, type HydratedDocument, type InferSchemaType, type Model } from 'mongoose';

/**
 * Pending invite registry — HMAC tokens alone are not enough for revocation.
 * Rows are removed on accept, expiry (TTL), or circle cascade delete.
 */
const circleInviteSchema = new Schema(
  {
    jti: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
    circleId: {
      type: String,
      required: true,
      trim: true,
    },
    inviterUid: {
      type: String,
      required: true,
      trim: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'circle_invites',
    versionKey: false,
  },
);

circleInviteSchema.index({ jti: 1 }, { unique: true, name: 'uniq_invite_jti' });
circleInviteSchema.index({ circleId: 1 }, { name: 'idx_invite_circleId' });
circleInviteSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'ttl_invite_expiresAt' },
);

export type CircleInviteAttrs = InferSchemaType<typeof circleInviteSchema>;
export type CircleInviteDocument = HydratedDocument<CircleInviteAttrs>;
export type CircleInviteModelType = Model<CircleInviteAttrs>;

export const CircleInvite = model<CircleInviteAttrs>('CircleInvite', circleInviteSchema);
