import type { RequestHandler } from 'express';
import { badRequest, unauthorized } from '../../shared/errors/AppError.js';
import { sendOk } from '../../shared/utils/response.js';
import { acceptCircleInvite, createCircleInvite } from './invite.service.js';
import type { createInviteBodySchema, joinCircleBodySchema } from './invite.schemas.js';
import type { z } from 'zod';

type CreateInviteBody = z.infer<typeof createInviteBodySchema>;
type JoinBody = z.infer<typeof joinCircleBodySchema>;

export const postCircleInvite: RequestHandler = async (req, res, next) => {
  try {
    const uid = req.auth?.uid;
    if (!uid) throw unauthorized();
    const circleId = req.params['circleId'];
    if (typeof circleId !== 'string' || !circleId) throw badRequest('circleId is required');
    const body = req.body as CreateInviteBody;
    const data = await createCircleInvite({
      circleId,
      actorUid: uid,
      ...(body.ttlSeconds !== undefined ? { ttlSeconds: body.ttlSeconds } : {}),
    });
    sendOk(res, data);
  } catch (err) {
    next(err);
  }
};

export const postCircleJoin: RequestHandler = async (req, res, next) => {
  try {
    const uid = req.auth?.uid;
    if (!uid) throw unauthorized();
    const circleId = req.params['circleId'];
    if (typeof circleId !== 'string' || !circleId) throw badRequest('circleId is required');
    const body = req.body as JoinBody;
    const data = await acceptCircleInvite({
      circleId,
      uid,
      displayName: body.displayName,
      inviteToken: body.inviteToken,
    });
    sendOk(res, data);
  } catch (err) {
    next(err);
  }
};
