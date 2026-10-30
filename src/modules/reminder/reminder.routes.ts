import { Router } from 'express';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { requireCircleOwner } from '../../shared/middleware/requireCircleAccess.js';
import { validateRequest } from '../../shared/middleware/validate.js';
import {
  deleteReminderHandler,
  putAppointmentStatus,
  putMedicationCompletion,
  putReminder,
  putTaskStatus,
} from './reminder.controller.js';
import {
  appointmentItemPathParamsSchema,
  completionBodySchema,
  medicationItemPathParamsSchema,
  reminderPathParamsSchema,
  statusBodySchema,
  taskItemPathParamsSchema,
} from './reminder.schemas.js';
import {
  appointmentDataSchema,
  medicationDataSchema,
  taskDataSchema,
} from './reminderData.schemas.js';

export const reminderRouter = Router({ mergeParams: true });

// Specific routes first so they are not shadowed by /:module/:itemId
reminderRouter.put(
  '/medication/:itemId/completion',
  requireAuth,
  requireCircleOwner,
  validateRequest({
    params: medicationItemPathParamsSchema,
    body: completionBodySchema,
  }),
  putMedicationCompletion,
);

reminderRouter.put(
  '/appointment/:itemId/status',
  requireAuth,
  requireCircleOwner,
  validateRequest({
    params: appointmentItemPathParamsSchema,
    body: statusBodySchema,
  }),
  putAppointmentStatus,
);

reminderRouter.put(
  '/task/:itemId/status',
  requireAuth,
  requireCircleOwner,
  validateRequest({
    params: taskItemPathParamsSchema,
    body: statusBodySchema,
  }),
  putTaskStatus,
);

/**
 * Module-specific body validation is applied in the service via parseReminderData.
 * Route-level Zod ensures structural basics; path identity is never taken from body.
 */
reminderRouter.put(
  '/:module/:itemId',
  requireAuth,
  requireCircleOwner,
  validateRequest({ params: reminderPathParamsSchema }),
  (req, _res, next) => {
    const module = req.params['module'];
    try {
      if (module === 'medication') {
        medicationDataSchema.parse(req.body);
      } else if (module === 'appointment') {
        appointmentDataSchema.parse(req.body);
      } else if (module === 'task') {
        taskDataSchema.parse(req.body);
      }
      next();
    } catch (err) {
      next(err);
    }
  },
  putReminder,
);

reminderRouter.delete(
  '/:module/:itemId',
  requireAuth,
  requireCircleOwner,
  validateRequest({ params: reminderPathParamsSchema }),
  deleteReminderHandler,
);
