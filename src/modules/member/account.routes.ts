import { Router } from 'express';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { validateRequest } from '../../shared/middleware/validate.js';
import { deleteMe, deleteMemberByOwner, deleteMyDevice } from './account.controller.js';
import {
  deleteMeQuerySchema,
  deleteMemberParamsSchema,
  deleteMemberQuerySchema,
  unregisterDeviceBodySchema,
} from './account.schemas.js';

export const accountRouter = Router();

accountRouter.delete(
  '/me',
  requireAuth,
  validateRequest({ query: deleteMeQuerySchema }),
  deleteMe,
);

accountRouter.delete(
  '/me/devices',
  requireAuth,
  validateRequest({ body: unregisterDeviceBodySchema }),
  deleteMyDevice,
);

accountRouter.delete(
  '/:uid',
  requireAuth,
  validateRequest({ params: deleteMemberParamsSchema, query: deleteMemberQuerySchema }),
  deleteMemberByOwner,
);
