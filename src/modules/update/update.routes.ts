import { Router } from 'express';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireCircleMember } from '../../shared/middleware/requireCircleAccess.js';
import { validateRequest } from '../../shared/middleware/validate.js';
import { postCircleUpdate } from './update.controller.js';
import { circleIdParamsSchema, updateShareBodySchema } from './update.schemas.js';

export const updateRouter = Router({ mergeParams: true });

updateRouter.post(
  '/',
  requireAuth,
  validateRequest({ params: circleIdParamsSchema, body: updateShareBodySchema }),
  requireCircleMember,
  postCircleUpdate,
);
