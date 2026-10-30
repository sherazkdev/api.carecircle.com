import { Router } from 'express';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireCircleMember } from '../../shared/middleware/requireCircleAccess.js';
import { validateRequest } from '../../shared/middleware/validate.js';
import { circleIdParamsSchema } from '../device/device.schemas.js';
import { putMyPrefs } from './member.controller.js';
import { memberPrefsBodySchema } from './member.schemas.js';

export const memberRouter = Router({ mergeParams: true });

memberRouter.put(
  '/me/prefs',
  requireAuth,
  validateRequest({ params: circleIdParamsSchema, body: memberPrefsBodySchema }),
  requireCircleMember,
  putMyPrefs,
);
