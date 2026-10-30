import { Router } from 'express';
import { createRateLimiter } from '../../shared/middleware/rateLimit.js';
import { validateRequest } from '../../shared/middleware/validate.js';
import { postIssueCircleCreateToken } from './issuer.controller.js';
import { issueCircleCreateTokenBodySchema } from './issuer.schemas.js';

export const issuerRouter = Router();

const issuerRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  keyGenerator: (req) => {
    const ip = req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
    return `issuer:${ip}`;
  },
});

issuerRouter.post(
  '/circle-create-tokens',
  issuerRateLimit,
  validateRequest({ body: issueCircleCreateTokenBodySchema }),
  postIssueCircleCreateToken,
);
