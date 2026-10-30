import { z } from 'zod';

export const memberPrefsBodySchema = z.object({
  medication: z.boolean(),
  appointment: z.boolean(),
  task: z.boolean(),
  updates: z.boolean(),
});

export type MemberPrefsBody = z.infer<typeof memberPrefsBodySchema>;
