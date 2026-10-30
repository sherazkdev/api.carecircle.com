import { conflict, forbidden, notFound } from '../../shared/errors/AppError.js';
import { removeMemberFromCircle } from '../../shared/db/cascades.js';
import { Circle } from '../circle/circle.model.js';
import { Member } from './member.model.js';

export type LeaveCircleResult = {
  uid: string;
  circleId: string;
  removed: boolean;
  devices: number;
  members: number;
};

export type DeleteMyMembershipsResult = {
  uid: string;
  mode: 'all' | 'one';
  circleIds: string[];
  totals: { devices: number; members: number };
};

/**
 * C4: ownership validation must complete before any membership/device deletes.
 */
async function assertNotOwningCircles(uid: string, circleId?: string): Promise<void> {
  if (circleId) {
    const circle = await Circle.findOne({ circleId }).lean();
    if (!circle) {
      throw notFound('Circle not found');
    }
    if (circle.ownerUid === uid) {
      throw conflict(
        'Circle owners must delete the circle before leaving or deleting their account',
        { reason: 'OWNER_MUST_DELETE_CIRCLE', circleId },
      );
    }
    return;
  }

  const owned = await Circle.find({ ownerUid: uid }).select({ circleId: 1 }).lean();
  if (owned.length > 0) {
    throw conflict(
      'Circle owners must delete owned circles before deleting account data',
      {
        reason: 'OWNER_MUST_DELETE_CIRCLE',
        circleIds: owned.map((c) => c.circleId),
      },
    );
  }
}

/** Leave one circle (non-owner). Idempotent if already gone. */
export async function leaveCircle(input: {
  uid: string;
  circleId: string;
}): Promise<LeaveCircleResult> {
  await assertNotOwningCircles(input.uid, input.circleId);

  const member = await Member.findOne({ circleId: input.circleId, uid: input.uid }).lean();
  if (!member) {
    return {
      uid: input.uid,
      circleId: input.circleId,
      removed: false,
      devices: 0,
      members: 0,
    };
  }

  const counts = await removeMemberFromCircle(input.circleId, input.uid);
  return {
    uid: input.uid,
    circleId: input.circleId,
    removed: true,
    devices: counts['devices'] ?? 0,
    members: counts['members'] ?? 0,
  };
}

/**
 * Remove authenticated user from all circles (or one via circleId).
 * Documented order: call this API **before** deleting the Firebase Auth account.
 */
export async function deleteMyMemberships(input: {
  uid: string;
  circleId?: string | undefined;
}): Promise<DeleteMyMembershipsResult> {
  await assertNotOwningCircles(input.uid, input.circleId);

  if (input.circleId) {
    const one = await leaveCircle({ uid: input.uid, circleId: input.circleId });
    return {
      uid: input.uid,
      mode: 'one',
      circleIds: one.removed ? [one.circleId] : [],
      totals: { devices: one.devices, members: one.members },
    };
  }

  const memberships = await Member.find({ uid: input.uid }).lean();
  let devices = 0;
  let members = 0;
  const circleIds: string[] = [];

  for (const m of memberships) {
    // Re-check ownership per circle in case of race with ownership transfer (none today).
    const circle = await Circle.findOne({ circleId: m.circleId }).lean();
    if (circle?.ownerUid === input.uid) {
      throw conflict(
        'Circle owners must delete owned circles before deleting account data',
        { reason: 'OWNER_MUST_DELETE_CIRCLE', circleId: m.circleId },
      );
    }
    const counts = await removeMemberFromCircle(m.circleId, input.uid);
    devices += counts['devices'] ?? 0;
    members += counts['members'] ?? 0;
    circleIds.push(m.circleId);
  }

  return {
    uid: input.uid,
    mode: 'all',
    circleIds,
    totals: { devices, members },
  };
}

/** Owner removes a non-owner member from a circle. Idempotent. */
export async function ownerRemoveMember(input: {
  actorUid: string;
  circleId: string;
  targetUid: string;
}): Promise<LeaveCircleResult> {
  const circle = await Circle.findOne({ circleId: input.circleId }).lean();
  if (!circle) {
    throw notFound('Circle not found');
  }
  if (circle.ownerUid !== input.actorUid) {
    throw forbidden('Owner permission required');
  }
  if (input.targetUid === circle.ownerUid) {
    throw forbidden('Circle owner cannot be removed; delete the circle instead');
  }

  const target = await Member.findOne({
    circleId: input.circleId,
    uid: input.targetUid,
  }).lean();
  if (!target) {
    return {
      uid: input.targetUid,
      circleId: input.circleId,
      removed: false,
      devices: 0,
      members: 0,
    };
  }

  const counts = await removeMemberFromCircle(input.circleId, input.targetUid);
  return {
    uid: input.targetUid,
    circleId: input.circleId,
    removed: true,
    devices: counts['devices'] ?? 0,
    members: counts['members'] ?? 0,
  };
}
