import { z } from 'zod';

export const memberPrefsBodySchema = z.object({
  medication: z.boolean(),
  appointment: z.boolean(),
  task: z.boolean(),
  updates: z.boolean(),
});

export type MemberPrefsBody = z.infer<typeof memberPrefsBodySchema>;

export const memberRoleBodySchema = z.object({
  role: z.enum(['owner', 'member']),
});

export const memberUidParamsSchema = z.object({
  circleId: z.string().trim().min(1),
  uid: z.string().trim().min(1),
});

export type MemberRoleBody = z.infer<typeof memberRoleBodySchema>;
