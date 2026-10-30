import type { NextFunction, Request, Response } from 'express';
import { serviceUnavailable } from '../errors/AppError.js';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyGenerator?: (req: Request) => string;
};

function defaultKey(req: Request): string {
  const uid = req.auth?.uid;
  if (uid) return `uid:${uid}`;
  const forwarded = req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return `ip:${forwarded ?? req.ip ?? 'unknown'}`;
}

/**
 * Lightweight in-process rate limiter (suitable for single API replica).
 * For multi-replica production, place a shared limiter at the reverse proxy.
 */
export function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, max, keyGenerator = defaultKey } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyGenerator(req);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      next(serviceUnavailable('Rate limit exceeded'));
      return;
    }
    next();
  };
}

/** Test helper */
export function resetRateLimitBucketsForTests(): void {
  buckets.clear();
}
