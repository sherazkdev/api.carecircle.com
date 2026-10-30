import { z } from 'zod';

export const issueCircleCreateTokenBodySchema = z
  .object({
    circleId: z.string().trim().min(1),
    ownerUid: z.string().trim().min(1),
    timezone: z.string().trim().min(1).optional(),
    ttlSeconds: z.coerce.number().int().positive().optional(),
  })
  .strict();
