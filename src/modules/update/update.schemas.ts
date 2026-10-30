import { z } from 'zod';

export const updateShareBodySchema = z
  .object({
    updateType: z.string().trim().min(1).max(64),
    /** Ignored for identity (C3) — accepted for Spec compatibility only. */
    senderName: z.string().max(200).optional(),
    notes: z.string().trim().min(1).max(2000),
  })
  .strict();

export type UpdateShareBody = z.infer<typeof updateShareBodySchema>;

export const circleIdParamsSchema = z.object({
  circleId: z.string().trim().min(1),
});
