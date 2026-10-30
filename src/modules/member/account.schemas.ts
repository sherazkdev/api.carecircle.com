import { z } from 'zod';

export const deleteMeQuerySchema = z.object({
  circleId: z.string().trim().min(1).optional(),
});

export type DeleteMeQuery = z.infer<typeof deleteMeQuerySchema>;

export const deleteMemberParamsSchema = z.object({
  uid: z.string().trim().min(1),
});

export const deleteMemberQuerySchema = z.object({
  circleId: z.string().trim().min(1),
});
