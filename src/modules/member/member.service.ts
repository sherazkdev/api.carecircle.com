import { removeMemberFromCircle } from '../../shared/db/cascades.js';
import { forbidden, notFound } from '../../shared/errors/AppError.js';
import { Circle } from '../circle/circle.model.js';
import { Member } from './member.model.js';
import type { MemberPrefsBody } from './member.schemas.js';

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
