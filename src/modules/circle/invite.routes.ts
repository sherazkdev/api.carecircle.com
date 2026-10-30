import { Router } from 'express';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireCircleOwner } from '../../shared/middleware/requireCircleAccess.js';
import { createRateLimiter } from '../../shared/middleware/rateLimit.js';
import { validateRequest } from '../../shared/middleware/validate.js';
import { postCircleInvite, postCircleJoin } from './invite.controller.js';
import {
  circleIdParamsSchema,
  createInviteBodySchema,
  joinCircleBodySchema,
} from './invite.schemas.js';

export const inviteRouter = Router({ mergeParams: true });

const joinRateLimit = createRateLimiter({ windowMs: 60_000, max: 20 });

inviteRouter.post(
  '/invites',
  requireAuth,
  validateRequest({ params: circleIdParamsSchema, body: createInviteBodySchema }),
  requireCircleOwner,
  postCircleInvite,
);

inviteRouter.post(
  '/join',
  joinRateLimit,
  requireAuth,
  validateRequest({ params: circleIdParamsSchema, body: joinCircleBodySchema }),
  postCircleJoin,
);
