import type { Response } from 'express';
import type { ErrorCode } from '../errors/AppError.js';

export type SuccessBody<T> = {
  ok: true;
  data: T;
};

export type ErrorBody = {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
};

export function sendOk<T>(res: Response, data: T, statusCode = 200): void {
  const body: SuccessBody<T> = { ok: true, data };
  res.status(statusCode).json(body);
}

export function sendError(
  res: Response,
  statusCode: number,
  code: ErrorCode,
  message: string,
  details?: unknown,
): void {
  const error: ErrorBody['error'] = { code, message };
  if (details !== undefined) {
    error.details = details;
  }
  const body: ErrorBody = { ok: false, error };
  res.status(statusCode).json(body);
}
