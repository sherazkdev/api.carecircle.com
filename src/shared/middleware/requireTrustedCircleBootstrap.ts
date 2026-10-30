import type { NextFunction, Request, Response } from 'express';
import {
  assertBootstrapHttpEnabled,
  verifyAndConsumeCircleCreateToken,
} from '../../modules/circle/ownershipProof.js';
import { badRequest, unauthorized } from '../errors/AppError.js';

/**
 * Verifies a trusted P2 circle-create token for `:circleId`.
 *
 * Token sources (header preferred):
 * - Header `X-Circle-Create-Token: <token>`
 * - Body `{ ownershipProof: "<token>" }`
 *
 * HTTP bootstrap that persists ownership remains gated by
 * `CIRCLE_BOOTSTRAP_ENABLED` (default false) until a trusted issuer exists.
 */
export async function requireTrustedCircleBootstrap(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    assertBootstrapHttpEnabled();

    const uid = req.auth?.uid;
    if (!uid) {
      throw unauthorized('Authentication required');
    }

    const circleId = req.params['circleId'];
    if (!circleId || typeof circleId !== 'string') {
      throw badRequest('circleId path parameter is required');
    }

    const headerToken = req.header('x-circle-create-token')?.trim();
    const bodyToken =
      typeof req.body?.ownershipProof === 'string' ? req.body.ownershipProof.trim() : undefined;
    const token = headerToken || bodyToken;
    if (!token) {
      throw badRequest('Missing circle create token (X-Circle-Create-Token or ownershipProof)');
    }

    // Never trust client-supplied role for ownership.
    if (req.body && typeof req.body === 'object' && 'role' in req.body) {
      delete (req.body as { role?: unknown }).role;
    }

    const proof = await verifyAndConsumeCircleCreateToken({
      token,
      expectedUid: uid,
      expectedCircleId: circleId,
    });

    req.circleBootstrap = proof;
    next();
  } catch (err) {
    next(err);
  }
}
