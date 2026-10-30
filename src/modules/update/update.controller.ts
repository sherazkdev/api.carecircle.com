import type { RequestHandler } from 'express';
import { unauthorized } from '../../shared/errors/AppError.js';
import { sendOk } from '../../shared/utils/response.js';
import type { UpdateShareBody } from './update.schemas.js';
import { shareCircleUpdate } from './update.service.js';

export const postCircleUpdate: RequestHandler = async (req, res, next) => {
  try {
    const uid = req.auth?.uid;
    if (!uid) {
      throw unauthorized();
    }
    const membership = req.circleMembership;
    if (!membership) {
      throw unauthorized('Circle membership required');
    }

    const headerKey = req.header('Idempotency-Key') ?? req.header('idempotency-key');
    const idempotencyKey =
      typeof headerKey === 'string' && headerKey.trim() ? headerKey.trim() : undefined;

    const data = await shareCircleUpdate({
      circleId: membership.circleId,
      senderUid: uid,
      senderDisplayName: membership.displayName,
      body: req.body as UpdateShareBody,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });

    sendOk(res, data);
  } catch (err) {
    next(err);
  }
};
