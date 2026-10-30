import type { RequestHandler } from 'express';
import { badRequest, unauthorized } from '../../shared/errors/AppError.js';
import { sendOk } from '../../shared/utils/response.js';
import type { RegisterDeviceBody } from './device.schemas.js';
import { registerDevice } from './device.service.js';

export const postRegisterDevice: RequestHandler = async (req, res, next) => {
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

    const data = await registerDevice({
      uid,
      circleId,
      body: req.body as RegisterDeviceBody,
    });
    sendOk(res, data);
  } catch (err) {
    next(err);
  }
};
