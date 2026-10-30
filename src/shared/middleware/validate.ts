import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../errors/AppError.js';

type RequestSchemas = {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
};

function replaceRequestProperty(
  req: Request,
  key: 'params' | 'query' | 'body',
  value: unknown,
): void {
  try {
    // Express 5 may expose read-only getters for query/params.
    (req as unknown as Record<string, unknown>)[key] = value;
  } catch {
    Object.defineProperty(req, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
}

/**
 * Generic Zod request validator.
 * Validates and replaces parsed values; compatible with Express 5 read-only query.
 */
export function validateRequest(schemas: RequestSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) {
        replaceRequestProperty(req, 'params', schemas.params.parse(req.params));
      }
      if (schemas.query) {
        replaceRequestProperty(req, 'query', schemas.query.parse(req.query));
      }
      if (schemas.body) {
        replaceRequestProperty(req, 'body', schemas.body.parse(req.body));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function assertNeverReached(message: string): never {
  throw new AppError(500, 'INTERNAL_ERROR', message);
}
