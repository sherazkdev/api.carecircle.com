import type { NextFunction, Request, Response } from 'express';
import { Circle } from '../../modules/circle/circle.model.js';
import { Member } from '../../modules/member/member.model.js';
import { forbidden, notFound, unauthorized } from '../errors/AppError.js';

function requireAuthenticatedUid(req: Request): string {
  const uid = req.auth?.uid;
  if (!uid) {
    throw unauthorized('Authentication required');
  }
  return uid;
}

function circleIdFromParams(req: Request): string {
  const circleId = req.params['circleId'];
  if (!circleId || typeof circleId !== 'string') {
    throw notFound('Circle not found');
  }
  return circleId;
}

async function loadMembership(req: Request): Promise<void> {
  const uid = requireAuthenticatedUid(req);
  const circleId = circleIdFromParams(req);

  const circle = await Circle.findOne({ circleId }).lean();
  if (!circle) {
    throw notFound('Circle not found');
  }

  const member = await Member.findOne({ circleId, uid }).lean();
  if (!member) {
    throw forbidden('Not a member of this circle');
  }

  if (member.role === 'owner' && circle.ownerUid !== uid) {
    throw forbidden('Membership role is inconsistent with circle ownership');
  }

  const role = circle.ownerUid === uid ? 'owner' : 'member';

  req.circleMembership = {
    circleId,
    uid,
    role,
    displayName: member.displayName,
  };
}

/**
 * Ensures the authenticated user is a member of `:circleId`.
 * Loads membership from MongoDB — never trusts client `role`.
 */
export async function requireCircleMember(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await loadMembership(req);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Ensures the authenticated user is the circle owner (C1 / owner-only APIs).
 * Authoritative check: `circles.ownerUid === auth.uid` (ignores body.role).
 */
export async function requireCircleOwner(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await loadMembership(req);
    if (req.circleMembership?.role !== 'owner') {
      throw forbidden('Owner permission required');
    }
    next();
  } catch (err) {
    next(err);
  }
}
