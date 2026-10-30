import { z } from 'zod';
import { DEVICE_PLATFORMS } from '../../shared/types/domain.js';
import { isValidIanaTimezone } from '../../shared/utils/timezone.js';

export const circleIdParamsSchema = z.object({
  circleId: z.string().min(1),
});

export const registerDeviceBodySchema = z.object({
  fcmToken: z.string().min(1),
  platform: z.enum(DEVICE_PLATFORMS),
  displayName: z.string().min(1),
  timezone: z
    .string()
    .min(1)
    .refine(isValidIanaTimezone, 'timezone must be a valid IANA zone')
    .optional(),
  /** Ignored for authorization — accepted only for Spec payload compatibility. */
  role: z.enum(['owner', 'member']).optional(),
  /** P2 create token when establishing a new circle (gated by CIRCLE_BOOTSTRAP_ENABLED). */
  ownershipProof: z.string().min(1).optional(),
});

export type RegisterDeviceBody = z.infer<typeof registerDeviceBodySchema>;
