import { Router } from 'express';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { validateRequest } from '../../shared/middleware/validate.js';
import { postRegisterDevice } from './device.controller.js';
import { circleIdParamsSchema, registerDeviceBodySchema } from './device.schemas.js';

export const deviceRouter = Router({ mergeParams: true });

deviceRouter.post(
  '/',
  requireAuth,
  validateRequest({ params: circleIdParamsSchema, body: registerDeviceBodySchema }),
  postRegisterDevice,
);
