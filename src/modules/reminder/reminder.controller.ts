import type { RequestHandler } from 'express';
import { badRequest, unauthorized } from '../../shared/errors/AppError.js';
import type { ReminderModule } from '../../shared/types/domain.js';
import { sendOk } from '../../shared/utils/response.js';
import type { CompletionBody, StatusBody } from './reminder.schemas.js';
import {
  deleteReminder,
  setAppointmentStatus,
  setMedicationCompletion,
  setTaskStatus,
  upsertReminder,
} from './reminder.service.js';

function pathString(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string' || !value) {
    throw badRequest(`${name} is required`);
  }
  return value;
}

export const putReminder: RequestHandler = async (req, res, next) => {
  try {
    if (!req.auth?.uid) {
      throw unauthorized();
    }
    const circleId = pathString(req.params['circleId'], 'circleId');
    const module = pathString(req.params['module'], 'module') as ReminderModule;
    const itemId = pathString(req.params['itemId'], 'itemId');

    const data = await upsertReminder({
      circleId,
      module,
      itemId,
      body: req.body,
    });
    sendOk(res, data);
  } catch (err) {
    next(err);
  }
};

export const deleteReminderHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.auth?.uid) {
      throw unauthorized();
    }
    const circleId = pathString(req.params['circleId'], 'circleId');
    const module = pathString(req.params['module'], 'module') as ReminderModule;
    const itemId = pathString(req.params['itemId'], 'itemId');

    const data = await deleteReminder({ circleId, module, itemId });
    sendOk(res, data);
  } catch (err) {
    next(err);
  }
};

export const putMedicationCompletion: RequestHandler = async (req, res, next) => {
  try {
    const uid = req.auth?.uid;
    if (!uid) {
      throw unauthorized();
    }
    const circleId = pathString(req.params['circleId'], 'circleId');
    const itemId = pathString(req.params['itemId'], 'itemId');
    const body = req.body as CompletionBody;

    const data = await setMedicationCompletion({
      circleId,
      itemId,
      uid,
      occurrenceKey: body.occurrenceKey,
      completed: body.completed,
    });
    sendOk(res, data);
  } catch (err) {
    next(err);
  }
};

export const putAppointmentStatus: RequestHandler = async (req, res, next) => {
  try {
    if (!req.auth?.uid) {
      throw unauthorized();
    }
    const circleId = pathString(req.params['circleId'], 'circleId');
    const itemId = pathString(req.params['itemId'], 'itemId');
    const body = req.body as StatusBody;

    const data = await setAppointmentStatus({
      circleId,
      itemId,
      status: body.status,
    });
    sendOk(res, data);
  } catch (err) {
    next(err);
  }
};

export const putTaskStatus: RequestHandler = async (req, res, next) => {
  try {
    if (!req.auth?.uid) {
      throw unauthorized();
    }
    const circleId = pathString(req.params['circleId'], 'circleId');
    const itemId = pathString(req.params['itemId'], 'itemId');
    const body = req.body as StatusBody;

    const data = await setTaskStatus({
      circleId,
      itemId,
      status: body.status,
    });
    sendOk(res, data);
  } catch (err) {
    next(err);
  }
};
