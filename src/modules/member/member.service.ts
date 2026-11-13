import { removeMemberFromCircle } from '../../shared/db/cascades.js';
import { forbidden, notFound } from '../../shared/errors/AppError.js';
import { Circle } from '../circle/circle.model.js';
import { Member } from './member.model.js';
import type { MemberPrefsBody } from './member.schemas.js';

export async function actorIsOwner(circleId: string, uid: string, ownerUid: string): Promise<boolean> {
  if (uid === ownerUid) {
    return true;
  }
  const member = await Member.findOne({ circleId, uid }).select({ role: 1 }).lean();
  return member?.role === 'owner';
}

export async function updateMyPrefs(input: {
  circleId: string;
  uid: string;
  prefs: MemberPrefsBody;
}) {
  const member = await Member.findOneAndUpdate(
    { circleId: input.circleId, uid: input.uid },
    { $set: { prefs: input.prefs } },
    { returnDocument: 'after' },
  );

  if (!member) {
    throw notFound('Membership not found');
  }

  return {
    circleId: member.circleId,
    uid: member.uid,
    prefs: member.prefs,
  };
}

/**
 * Promote or demote a member. The founding owner stays an owner.
 * Any current owner may call this. Inviting someone as owner uses the invite API.
 */
export async function setMemberRole(input: {
  circleId: string;
  actorUid: string;
  targetUid: string;
  role: 'owner' | 'member';
}) {
  const circle = await Circle.findOne({ circleId: input.circleId }).lean();
  if (!circle) {
    throw notFound('Circle not found');
  }
  if (!(await actorIsOwner(input.circleId, input.actorUid, circle.ownerUid))) {
    throw forbidden('Owner permission required');
  }

  const target = await Member.findOne({ circleId: input.circleId, uid: input.targetUid });
  if (!target) {
    throw notFound('Membership not found');
  }
  if (target.uid === circle.ownerUid && input.role !== 'owner') {
    throw forbidden('The original owner stays an owner');
  }

  target.role = input.role;
  await target.save();

  return {
    circleId: target.circleId,
    uid: target.uid,
    role: target.role === 'owner' ? 'owner' as const : 'member' as const,
  };
}

/**
 * Remove a member and their devices in a circle.
 * Owner self-removal is rejected here; Phase 8 account-delete uses C4 409 rules.
 */
export async function removeMemberWithCleanup(input: {
  circleId: string;
  uid: string;
  actorUid: string;
  actorIsOwner: boolean;
}): Promise<{ devices: number; members: number }> {
  const circle = await Circle.findOne({ circleId: input.circleId }).lean();
  if (!circle) {
    throw notFound('Circle not found');
  }

  if (input.uid === circle.ownerUid) {
    throw forbidden('Circle owner cannot be removed via member cleanup; delete the circle first');
  }

  const isSelf = input.actorUid === input.uid;
  if (!isSelf && !input.actorIsOwner) {
    throw forbidden('Only the owner can remove another member');
  }

  const target = await Member.findOne({ circleId: input.circleId, uid: input.uid }).lean();
  if (!target) {
    throw notFound('Membership not found');
  }

  const counts = await removeMemberFromCircle(input.circleId, input.uid);
  return {
    devices: counts['devices'] ?? 0,
    members: counts['members'] ?? 0,
  };
}
