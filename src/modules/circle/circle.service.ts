import { forbidden, notFound } from '../../shared/errors/AppError.js';
import { deleteCircleCascade } from '../../shared/db/cascades.js';
import { runWithOptionalTransaction } from '../../shared/db/transactions.js';
import { Circle } from './circle.model.js';

export type DeleteCircleResult = {
  circleId: string;
  deleted: boolean;
  transactional: boolean;
  jobs: number;
  completions: number;
  reminderItems: number;
  devices: number;
  members: number;
  deliveryAttempts: number;
  updateOutbox: number;
  circles: number;
};

const emptyCounts = {
  jobs: 0,
  completions: 0,
  reminderItems: 0,
  devices: 0,
  members: 0,
  deliveryAttempts: 0,
  updateOutbox: 0,
  circles: 0,
};

/**
 * Owner-only circle cascade. Idempotent: missing circle → deleted:false.
 * Uses a transaction when MongoDB supports it; otherwise ordered non-atomic deletes
 * with `transactional: false` (never pretends atomicity).
 */
export async function deleteCircleAsOwner(input: {
  circleId: string;
  actorUid: string;
}): Promise<DeleteCircleResult> {
  const circle = await Circle.findOne({ circleId: input.circleId }).lean();
  if (!circle) {
    return {
      circleId: input.circleId,
      deleted: false,
      transactional: true,
      ...emptyCounts,
    };
  }

  if (circle.ownerUid !== input.actorUid) {
    throw forbidden('Owner permission required');
  }

  return runWithOptionalTransaction(async (session) => {
    let freshQuery = Circle.findOne({ circleId: input.circleId });
    if (session) {
      freshQuery = freshQuery.session(session);
    }
    const fresh = await freshQuery.lean();
    if (!fresh) {
      return {
        circleId: input.circleId,
        deleted: false,
        ...emptyCounts,
      };
    }
    if (fresh.ownerUid !== input.actorUid) {
      throw notFound('Circle not found');
    }
    const counts = await deleteCircleCascade(input.circleId, session);
    return {
      circleId: input.circleId,
      deleted: (counts['circles'] ?? 0) > 0,
      jobs: counts['jobs'] ?? 0,
      completions: counts['completions'] ?? 0,
      reminderItems: counts['reminderItems'] ?? 0,
      devices: counts['devices'] ?? 0,
      members: counts['members'] ?? 0,
      deliveryAttempts: counts['deliveryAttempts'] ?? 0,
      updateOutbox: counts['updateOutbox'] ?? 0,
      circles: counts['circles'] ?? 0,
    };
  });
}
