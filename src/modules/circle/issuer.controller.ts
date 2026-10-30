import type { RequestHandler } from 'express';
import { sendOk } from '../../shared/utils/response.js';
import { assertTrustedIssuer, issueCircleCreateToken } from './issuer.service.js';
import type { z } from 'zod';
import type { issueCircleCreateTokenBodySchema } from './issuer.schemas.js';

type IssueBody = z.infer<typeof issueCircleCreateTokenBodySchema>;

export const postIssueCircleCreateToken: RequestHandler = async (req, res, next) => {
  try {
    assertTrustedIssuer(req.header('x-issuer-api-key') ?? undefined);
    const body = req.body as IssueBody;
    const data = issueCircleCreateToken({
      circleId: body.circleId,
      ownerUid: body.ownerUid,
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.ttlSeconds !== undefined ? { ttlSeconds: body.ttlSeconds } : {}),
    });
    sendOk(res, data);
  } catch (err) {
    next(err);
  }
};
