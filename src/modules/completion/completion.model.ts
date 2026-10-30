import { Schema, model, type HydratedDocument, type InferSchemaType, type Model } from 'mongoose';
import { isValidOccurrenceKey } from '../../shared/utils/occurrenceKey.js';

const completionSchema = new Schema(
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
    occurrenceKey: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (value: string) => isValidOccurrenceKey(value),
        message: 'occurrenceKey must match y-m-d-h-m without zero-padding',
      },
    },
    completed: {
      type: Boolean,
      required: true,
    },
    updatedBy: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    collection: 'completions',
    versionKey: false,
  },
);

completionSchema.index(
  { circleId: 1, itemId: 1, occurrenceKey: 1 },
  { unique: true, name: 'uniq_circle_item_occurrence' },
);

export type CompletionAttrs = InferSchemaType<typeof completionSchema>;
export type CompletionDocument = HydratedDocument<CompletionAttrs>;
export type CompletionModelType = Model<CompletionAttrs>;

export const Completion = model<CompletionAttrs>('Completion', completionSchema);
