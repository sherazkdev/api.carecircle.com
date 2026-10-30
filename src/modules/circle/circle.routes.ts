import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { validateRequest } from '../../shared/middleware/validate.js';
import { deleteCircleHandler } from './circle.controller.js';

const circleIdParamsSchema = z.object({
  circleId: z.string().trim().min(1),
});

export const circleRouter = Router({ mergeParams: true });

/**
 * Owner check is enforced in the service against circles.ownerUid (not client role).
 * Missing circle → 200 { deleted: false } for idempotent repeats.
 */
circleRouter.delete(
  '/',
  requireAuth,
  validateRequest({ params: circleIdParamsSchema }),
  deleteCircleHandler,
);
