import type { RequestHandler } from 'express';
import { badRequest, unauthorized } from '../../shared/errors/AppError.js';
import { sendOk } from '../../shared/utils/response.js';
import type { MemberPrefsBody } from './member.schemas.js';
import { updateMyPrefs } from './member.service.js';

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
