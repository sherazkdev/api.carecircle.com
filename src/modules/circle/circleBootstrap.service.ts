import { Circle } from './circle.model.js';
import { Member } from '../member/member.model.js';
import { DEFAULT_MEMBER_PREFS } from '../../shared/types/domain.js';
import { conflict, serviceUnavailable } from '../../shared/errors/AppError.js';
import { assertBootstrapHttpEnabled } from './ownershipProof.js';
import type { VerifiedCircleCreateProof } from './ownershipProof.types.js';
import { isValidIanaTimezone } from '../../shared/utils/timezone.js';

export type BootstrapCircleInput = {
  proof: VerifiedCircleCreateProof;
  displayName: string;
  /** Fallback timezone if proof omits one */
  timezone?: string;
};

/**
 * Establishes first-owner records from a verified P2 proof.
 *
 * NOT mounted on HTTP routes while `CIRCLE_BOOTSTRAP_ENABLED=false`.
 * Provided for race-safe persistence tests and future CF-integrated activation.
 */
export async function bootstrapCircleOwnership(input: BootstrapCircleInput): Promise<{
  circleId: string;
  ownerUid: string;
}> {
  assertBootstrapHttpEnabled();

  const timezone = input.proof.timezone ?? input.timezone;
  if (!timezone || !isValidIanaTimezone(timezone)) {
    throw serviceUnavailable('Bootstrap requires a valid IANA timezone');
  }

  try {
    await Circle.create({
      circleId: input.proof.circleId,
      ownerUid: input.proof.ownerUid,
      timezone,
    });
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: number }).code === 11000
    ) {
      throw conflict('Circle already exists');
    }
    throw err;
  }

  try {
    await Member.create({
      circleId: input.proof.circleId,
      uid: input.proof.ownerUid,
      role: 'owner',
      displayName: input.displayName,
      prefs: { ...DEFAULT_MEMBER_PREFS },
    });
  } catch (err) {
    // Compensate circle insert on member failure (best-effort without multi-doc txn)
    await Circle.deleteOne({ circleId: input.proof.circleId });
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: number }).code === 11000
    ) {
      throw conflict('Owner membership already exists for this circle');
    }
    throw err;
  }

  return { circleId: input.proof.circleId, ownerUid: input.proof.ownerUid };
}
