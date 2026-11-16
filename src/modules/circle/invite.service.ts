import { getEnv } from '../../config/env.js';
import { DEFAULT_MEMBER_PREFS } from '../../shared/types/domain.js';
import { conflict, forbidden, notFound } from '../../shared/errors/AppError.js';
import { Member } from '../member/member.model.js';
import { Circle } from './circle.model.js';
import {
  inspectCircleInviteToken,
  signCircleInviteToken,
  verifyAndConsumeCircleInviteToken,
} from './inviteProof.js';

export async function createCircleInvite(input: {
  circleId: string;
  actorUid: string;
  ttlSeconds?: number;
  role?: 'owner' | 'member';
}): Promise<{ inviteToken: string; circleId: string; role: 'owner' | 'member'; expiresInSeconds: number }> {
  const circle = await Circle.findOne({ circleId: input.circleId }).lean();
  if (!circle) {
    throw notFound('Circle not found');
  }
  const actor = await Member.findOne({ circleId: input.circleId, uid: input.actorUid }).lean();
  if (circle.ownerUid !== input.actorUid && actor?.role !== 'owner') {
    throw forbidden('Owner permission required');
  }
  const role = input.role === 'owner' ? 'owner' : 'member';

  const maxTtl = getEnv().CIRCLE_INVITE_TOKEN_MAX_TTL_SECONDS;
  const expiresInSeconds = Math.min(
    input.ttlSeconds ?? Math.min(maxTtl, 86_400),
    maxTtl,
  );

  const token = await signCircleInviteToken({
    circleId: input.circleId,
    inviterUid: input.actorUid,
    role,
    ttlSeconds: expiresInSeconds,
  });

  return {
    inviteToken: token,
    circleId: input.circleId,
    role,
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
  role: 'owner' | 'member';
  displayName: string;
  created: boolean;
}> {
  const circle = await Circle.findOne({ circleId: input.circleId }).lean();
  if (!circle) {
    throw notFound('Circle not found');
  }

  const existing = await Member.findOne({ circleId: input.circleId, uid: input.uid }).lean();
  if (existing) {
    let role: 'owner' | 'member' = existing.role === 'owner' ? 'owner' : 'member';
    // Already in the circle: an owner invite can promote them without a second membership.
    try {
      const peeked = inspectCircleInviteToken(input.inviteToken);
      if (
        peeked.role === 'owner' &&
        existing.role !== 'owner' &&
        peeked.circleId === input.circleId
      ) {
        await verifyAndConsumeCircleInviteToken({
          token: input.inviteToken,
          expectedCircleId: input.circleId,
        });
        await Member.updateOne(
          { circleId: input.circleId, uid: input.uid },
          { $set: { role: 'owner' } },
        );
        role = 'owner';
      }
    } catch {
      // Invalid token while already a member stays an idempotent accept.
    }
    return {
      circleId: input.circleId,
      uid: input.uid,
      role,
      displayName: existing.displayName,
      created: false,
    };
  }

  const ownerStillMember = await Member.exists({
    circleId: input.circleId,
    uid: circle.ownerUid,
  });
  if (input.uid === circle.ownerUid && ownerStillMember) {
    throw conflict('Circle owner is already a member');
  }

  const proof = await verifyAndConsumeCircleInviteToken({
    token: input.inviteToken,
    expectedCircleId: input.circleId,
  });
  // The circle was left with only a pending invite: whoever joins becomes the owner.
  const claimCircle = !ownerStillMember;
  const joinedRole: 'owner' | 'member' =
    claimCircle || proof.role === 'owner' ? 'owner' : 'member';

  try {
    const member = await Member.create({
      circleId: input.circleId,
      uid: input.uid,
      role: joinedRole,
      displayName: input.displayName,
      prefs: { ...DEFAULT_MEMBER_PREFS },
    });
    if (claimCircle) {
      await Circle.updateOne({ circleId: input.circleId }, { $set: { ownerUid: member.uid } });
    }
    return {
      circleId: member.circleId,
      uid: member.uid,
      role: joinedRole,
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
          role: again.role === 'owner' ? 'owner' : 'member',
          displayName: again.displayName,
          created: false,
        };
      }
      throw conflict('Membership conflict');
    }
    throw err;
  }
}
