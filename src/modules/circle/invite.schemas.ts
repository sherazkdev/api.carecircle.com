import { z } from 'zod';

export const createInviteBodySchema = z
  .object({
    ttlSeconds: z.coerce.number().int().positive().max(604_800).optional(),
  })
  .strict();

export const joinCircleBodySchema = z
  .object({
    inviteToken: z.string().trim().min(10),
    displayName: z.string().trim().min(1).max(120),
  })
  .strict();

export const circleIdParamsSchema = z.object({
  circleId: z.string().trim().min(1),
});
