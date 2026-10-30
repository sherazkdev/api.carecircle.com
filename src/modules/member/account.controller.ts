import type { RequestHandler } from 'express';
import { badRequest, unauthorized } from '../../shared/errors/AppError.js';
import { sendOk } from '../../shared/utils/response.js';
import { deleteMyMemberships, ownerRemoveMember } from './account.service.js';

export const deleteMe: RequestHandler = async (req, res, next) => {
  try {
    const uid = req.auth?.uid;
    if (!uid) {
      throw unauthorized();
    }
    const circleIdRaw = req.query['circleId'];
    const circleId =
      typeof circleIdRaw === 'string' && circleIdRaw.trim() ? circleIdRaw.trim() : undefined;

    const data = await deleteMyMemberships({ uid, circleId });
    sendOk(res, data);
  } catch (err) {
    next(err);
  }
};

export const deleteMemberByOwner: RequestHandler = async (req, res, next) => {
  try {
    const actorUid = req.auth?.uid;
    if (!actorUid) {
      throw unauthorized();
    }
    const targetUid = req.params['uid'];
    if (typeof targetUid !== 'string' || !targetUid) {
      throw badRequest('uid is required');
    }
    const circleIdRaw = req.query['circleId'];
    if (typeof circleIdRaw !== 'string' || !circleIdRaw.trim()) {
      throw badRequest('circleId query parameter is required');
    }

    const data = await ownerRemoveMember({
      actorUid,
      circleId: circleIdRaw.trim(),
      targetUid,
    });
    sendOk(res, data);
  } catch (err) {
    next(err);
  }
};
