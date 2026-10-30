import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError.js';
import { sendError } from '../utils/response.js';
import { getLogger } from '../../config/logger.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  sendError(res, 404, 'NOT_FOUND', 'Route not found');
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const logger = getLogger();

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err: { message: err.message, code: err.code } }, 'Operational server error');
    }
    sendError(res, err.statusCode, err.code, err.message, err.details);
    return;
  }

  if (err instanceof ZodError) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Request validation failed', err.issues);
    return;
  }

  const message = err instanceof Error ? err.message : 'Unexpected error';
  logger.error(
    { err: { message, name: err instanceof Error ? err.name : 'UnknownError' } },
    'Unhandled error',
  );
  sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
};
