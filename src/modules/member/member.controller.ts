import type { RequestHandler } from 'express';
import { badRequest, unauthorized } from '../../shared/errors/AppError.js';
import { sendOk } from '../../shared/utils/response.js';
import type { MemberPrefsBody, MemberRoleBody } from './member.schemas.js';
import { setMemberRole, updateMyPrefs } from './member.service.js';

export const putMyPrefs: RequestHandler = async (req, res, next) => {
  try {
    const uid = req.auth?.uid;
    if (!uid) {
      throw unauthorized();
    }
    const circleIdParam = req.params['circleId'];
    const circleId = typeof circleIdParam === 'string' ? circleIdParam : undefined;
    if (!circleId) {
      throw badRequest('circleId is required');
    }

    const data = await updateMyPrefs({
      circleId,
      uid,
      prefs: req.body as MemberPrefsBody,
    });
    sendOk(res, data);
  } catch (err) {
    next(err);
  }
};

export const putMemberRole: RequestHandler = async (req, res, next) => {
  try {
    const actorUid = req.auth?.uid;
    if (!actorUid) {
      throw unauthorized();
    }
    const circleIdParam = req.params['circleId'];
    const targetUid = req.params['uid'];
    const circleId = typeof circleIdParam === 'string' ? circleIdParam : undefined;
    if (!circleId || typeof targetUid !== 'string' || !targetUid) {
      throw badRequest('circleId and uid are required');
    }
    const body = req.body as MemberRoleBody;
    const data = await setMemberRole({
      circleId,
      actorUid,
      targetUid,
      role: body.role,
    });
    sendOk(res, data);
  } catch (err) {
    next(err);
  }
};
