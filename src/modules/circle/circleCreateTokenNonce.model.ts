import { Schema, model, type HydratedDocument, type InferSchemaType, type Model } from 'mongoose';

/**
 * Replay store for P2 circle-create tokens.
 * Documents expire via TTL on `expiresAt`.
 */
const circleCreateTokenNonceSchema = new Schema(
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
    ownerUid: {
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
    collection: 'circle_create_token_nonces',
    versionKey: false,
  },
);

circleCreateTokenNonceSchema.index({ jti: 1 }, { unique: true, name: 'uniq_create_token_jti' });
circleCreateTokenNonceSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'ttl_create_token_expiresAt' },
);

export type CircleCreateTokenNonceAttrs = InferSchemaType<typeof circleCreateTokenNonceSchema>;
export type CircleCreateTokenNonceDocument = HydratedDocument<CircleCreateTokenNonceAttrs>;
export type CircleCreateTokenNonceModelType = Model<CircleCreateTokenNonceAttrs>;

export const CircleCreateTokenNonce = model<CircleCreateTokenNonceAttrs>(
  'CircleCreateTokenNonce',
  circleCreateTokenNonceSchema,
);
