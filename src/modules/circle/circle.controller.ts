import type { RequestHandler } from 'express';
import { badRequest, unauthorized } from '../../shared/errors/AppError.js';
import { sendOk } from '../../shared/utils/response.js';
import { deleteCircleAsOwner } from './circle.service.js';

export const deleteCircleHandler: RequestHandler = async (req, res, next) => {
  try {
    const uid = req.auth?.uid;
    if (!uid) {
      throw unauthorized();
    }
    const circleId = req.params['circleId'];
    if (typeof circleId !== 'string' || !circleId) {
      throw badRequest('circleId is required');
    }

    const data = await deleteCircleAsOwner({ circleId, actorUid: uid });
    sendOk(res, data);
  } catch (err) {
    next(err);
  }
};
