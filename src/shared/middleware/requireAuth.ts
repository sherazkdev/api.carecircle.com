import type { NextFunction, Request, Response } from 'express';
import {
  extractBearerToken,
  verifyFirebaseIdToken,
} from '../../modules/auth/firebaseAuth.service.js';

/**
 * Verifies Firebase ID token and attaches `req.auth`.
 * UID is taken exclusively from the verified token.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const idToken = extractBearerToken(req.header('authorization') ?? undefined);
    const decoded = await verifyFirebaseIdToken(idToken);
    if (!decoded.uid) {
      throw new Error('Token missing uid');
    }
    req.auth = {
      uid: decoded.uid,
      token: decoded,
    };
    next();
  } catch (err) {
    next(err);
  }
}
