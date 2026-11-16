import { conflict, forbidden, notFound } from '../../shared/errors/AppError.js';
import { deleteCircleCascade, removeMemberFromCircle } from '../../shared/db/cascades.js';
import { Circle } from '../circle/circle.model.js';
import { CircleInvite } from '../circle/circleInvite.model.js';
import { Device } from '../device/device.model.js';
import { Member } from './member.model.js';
import { actorIsOwner } from './member.service.js';

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

type CircleExitPlan =
  | { circleId: string; action: 'delete-circle' }
  | { circleId: string; action: 'hand-off'; successorUid: string }
  | { circleId: string; action: 'remove-member' };

/**
 * Founding owner exit. Does not change anyone's role.
 * Alone in the circle → delete the circle. Other members and no second owner → stop.
 * Another owner already exists → move ownerUid to that owner, then this user can leave.
 */
async function planCircleExit(uid: string, circleId: string): Promise<CircleExitPlan> {
  const circle = await Circle.findOne({ circleId }).lean();
  if (!circle) {
    return { circleId, action: 'remove-member' };
  }
  if (circle.ownerUid !== uid) {
    return { circleId, action: 'remove-member' };
  }

  const others = await Member.find({ circleId, uid: { $ne: uid } })
    .select({ uid: 1, role: 1 })
    .sort({ createdAt: 1 })
    .lean();
  if (others.length === 0) {
    const pendingInvite = await CircleInvite.findOne({
      circleId,
      expiresAt: { $gt: new Date() },
    })
      .select({ _id: 1 })
      .lean();
    // An outstanding invite must keep the circle so the invited person can still join.
    if (pendingInvite) {
      return { circleId, action: 'remove-member' };
    }
    return { circleId, action: 'delete-circle' };
  }

  const successor = others.find((member) => member.role === 'owner');
  if (!successor) {
    throw conflict('Promote another member to owner before leaving this circle', {
      reason: 'PROMOTE_MEMBER_BEFORE_LEAVING',
      circleId,
    });
  }
  return { circleId, action: 'hand-off', successorUid: successor.uid };
}

async function applyCircleExit(uid: string, plan: CircleExitPlan): Promise<LeaveCircleResult> {
  if (plan.action === 'delete-circle') {
    const counts = await deleteCircleCascade(plan.circleId);
    return {
      uid,
      circleId: plan.circleId,
      removed: (counts.circles ?? 0) > 0 || (counts.members ?? 0) > 0,
      devices: counts.devices ?? 0,
      members: counts.members ?? 0,
    };
  }

  if (plan.action === 'hand-off') {
    await Circle.updateOne(
      { circleId: plan.circleId, ownerUid: uid },
      { $set: { ownerUid: plan.successorUid } },
    );
  }

  const member = await Member.findOne({ circleId: plan.circleId, uid }).lean();
  if (!member) {
    return {
      uid,
      circleId: plan.circleId,
      removed: false,
      devices: 0,
      members: 0,
    };
  }

  const counts = await removeMemberFromCircle(plan.circleId, uid);
  return {
    uid,
    circleId: plan.circleId,
    removed: true,
    devices: counts['devices'] ?? 0,
    members: counts['members'] ?? 0,
  };
}

/** Leave one circle. Idempotent if already gone. */
export async function leaveCircle(input: {
  uid: string;
  circleId: string;
}): Promise<LeaveCircleResult> {
  const circle = await Circle.findOne({ circleId: input.circleId }).lean();
  if (!circle) {
    throw notFound('Circle not found');
  }
  const plan = await planCircleExit(input.uid, input.circleId);
  return applyCircleExit(input.uid, plan);
}

/**
 * Remove authenticated user from all circles (or one via circleId).
 * Documented order: call this API **before** deleting the Firebase Auth account.
 */
export async function deleteMyMemberships(input: {
  uid: string;
  circleId?: string | undefined;
}): Promise<DeleteMyMembershipsResult> {
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
  const plans: CircleExitPlan[] = [];
  for (const membership of memberships) {
    plans.push(await planCircleExit(input.uid, membership.circleId));
  }

  let devices = 0;
  let members = 0;
  const circleIds: string[] = [];

  for (const plan of plans) {
    const counts = await applyCircleExit(input.uid, plan);
    if (!counts.removed) {
      continue;
    }
    devices += counts.devices;
    members += counts.members;
    circleIds.push(plan.circleId);
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
  if (!(await actorIsOwner(input.circleId, input.actorUid, circle.ownerUid))) {
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
  if (target.role === 'owner') {
    throw forbidden('Cannot remove another owner');
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

/** Logout: drop this phone's token for the authenticated user, in every circle. */
export async function unregisterMyDevice(input: {
  uid: string;
  fcmToken: string;
}): Promise<{ uid: string; removed: number }> {
  const result = await Device.deleteMany({ uid: input.uid, fcmToken: input.fcmToken });
  return { uid: input.uid, removed: result.deletedCount };
}
