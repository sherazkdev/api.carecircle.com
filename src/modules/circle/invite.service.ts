import { getEnv } from '../../config/env.js';
import { DEFAULT_MEMBER_PREFS } from '../../shared/types/domain.js';
import { conflict, forbidden, notFound } from '../../shared/errors/AppError.js';
import { Member } from '../member/member.model.js';
import { Circle } from './circle.model.js';
import { signCircleInviteToken, verifyAndConsumeCircleInviteToken } from './inviteProof.js';

export async function createCircleInvite(input: {
  circleId: string;
  actorUid: string;
  ttlSeconds?: number;
}): Promise<{ inviteToken: string; circleId: string; expiresInSeconds: number }> {
  const circle = await Circle.findOne({ circleId: input.circleId }).lean();
  if (!circle) {
    throw notFound('Circle not found');
  }
  if (circle.ownerUid !== input.actorUid) {
    throw forbidden('Owner permission required');
  }

  const maxTtl = getEnv().CIRCLE_INVITE_TOKEN_MAX_TTL_SECONDS;
  const expiresInSeconds = Math.min(
    input.ttlSeconds ?? Math.min(maxTtl, 86_400),
    maxTtl,
  );

  const token = await signCircleInviteToken({
    circleId: input.circleId,
    inviterUid: input.actorUid,
    ttlSeconds: expiresInSeconds,
  });

  return {
    inviteToken: token,
    circleId: input.circleId,
    expiresInSeconds,
  };
}

export async function acceptCircleInvite(input: {
  circleId: string;
  uid: string;
  displayName: string;
  inviteToken: string;
}): Promise<{
  circleId: string;
  uid: string;
  role: 'member';
  displayName: string;
  created: boolean;
}> {
  const circle = await Circle.findOne({ circleId: input.circleId }).lean();
  if (!circle) {
    throw notFound('Circle not found');
  }

  const existing = await Member.findOne({ circleId: input.circleId, uid: input.uid }).lean();
  if (existing) {
    // Idempotent accept for already-member — still consume? Spec: idempotent acceptance.
    // Do not consume token if already a member so a shared link isn't burned by the owner re-joining.
    return {
      circleId: input.circleId,
      uid: input.uid,
      role: 'member',
      displayName: existing.displayName,
      created: false,
    };
  }

  if (input.uid === circle.ownerUid) {
    throw conflict('Circle owner is already a member');
  }

  await verifyAndConsumeCircleInviteToken({
    token: input.inviteToken,
    expectedCircleId: input.circleId,
  });

  try {
    const member = await Member.create({
      circleId: input.circleId,
      uid: input.uid,
      role: 'member',
      displayName: input.displayName,
      prefs: { ...DEFAULT_MEMBER_PREFS },
    });
    return {
      circleId: member.circleId,
      uid: member.uid,
      role: 'member',
      displayName: member.displayName,
      created: true,
    };
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: number }).code === 11000
    ) {
      const again = await Member.findOne({ circleId: input.circleId, uid: input.uid }).lean();
      if (again) {
        return {
          circleId: again.circleId,
          uid: again.uid,
          role: 'member',
          displayName: again.displayName,
          created: false,
        };
      }
      throw conflict('Membership conflict');
    }
    throw err;
  }
}
