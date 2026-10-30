import { Schema, model, type HydratedDocument, type InferSchemaType, type Model } from 'mongoose';
import { DEFAULT_MEMBER_PREFS, MEMBER_ROLES } from '../../shared/types/domain.js';

const prefsSchema = new Schema(
  {
    medication: { type: Boolean, required: true, default: true },
    appointment: { type: Boolean, required: true, default: true },
    task: { type: Boolean, required: true, default: true },
    updates: { type: Boolean, required: true, default: true },
  },
  { _id: false },
);

const memberSchema = new Schema(
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
    /**
     * Server-authoritative role. Must never be taken as proof from the client body (C2).
     */
    role: {
      type: String,
      required: true,
      enum: MEMBER_ROLES,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
    prefs: {
      type: prefsSchema,
      required: true,
      default: () => ({ ...DEFAULT_MEMBER_PREFS }),
    },
  },
  {
    timestamps: true,
    collection: 'members',
    versionKey: false,
  },
);

memberSchema.index({ circleId: 1, uid: 1 }, { unique: true, name: 'uniq_circle_uid' });
/** Non-unique: many ordinary members share role=member. */
memberSchema.index({ circleId: 1, role: 1 }, { name: 'idx_circle_role' });
/**
 * At most one owner per circle (partial unique).
 * Ordinary members are unaffected.
 */
memberSchema.index(
  { circleId: 1 },
  {
    unique: true,
    partialFilterExpression: { role: 'owner' },
    name: 'uniq_circle_single_owner',
  },
);
memberSchema.index({ uid: 1 }, { name: 'idx_uid' });

export type MemberAttrs = InferSchemaType<typeof memberSchema>;
export type MemberDocument = HydratedDocument<MemberAttrs>;
export type MemberModelType = Model<MemberAttrs>;

export const Member = model<MemberAttrs>('Member', memberSchema);
