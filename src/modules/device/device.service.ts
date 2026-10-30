import { Circle } from '../circle/circle.model.js';
import { bootstrapCircleOwnership } from '../circle/circleBootstrap.service.js';
import {
  assertBootstrapHttpEnabled,
  verifyAndConsumeCircleCreateToken,
} from '../circle/ownershipProof.js';
import { Member } from '../member/member.model.js';
import { DEFAULT_MEMBER_PREFS } from '../../shared/types/domain.js';
import { badRequest, forbidden, notFound } from '../../shared/errors/AppError.js';
import { Device } from './device.model.js';
import type { RegisterDeviceBody } from './device.schemas.js';

export type RegisterDeviceResult = {
  circleId: string;
  uid: string;
  role: 'owner' | 'member';
  displayName: string;
  platform: 'android' | 'ios';
  /** Present for response correlation only — never log the raw token in callers. */
  fcmTokenRegistered: true;
  timezone: string;
  createdCircle: boolean;
};

/**
 * Spec R5 helper — remove all device rows for an invalid FCM token.
 * Used by the notification engine (Phase 7); no public logout delete API (R3).
 */
export async function removeInvalidFcmToken(fcmToken: string): Promise<number> {
  const result = await Device.deleteMany({ fcmToken });
  return result.deletedCount;
}

export async function registerDevice(input: {
  uid: string;
  circleId: string;
  body: RegisterDeviceBody;
}): Promise<RegisterDeviceResult> {
  const { uid, circleId, body } = input;

  // R4 — reassign token away from any other account (all circles).
  await Device.releaseTokenFromOtherUsers(body.fcmToken, uid);

  let circle = await Circle.findOne({ circleId });
  let createdCircle = false;

  if (!circle) {
    // New circle requires trusted P2 proof — never client role.
    assertBootstrapHttpEnabled();
    if (!body.ownershipProof) {
      throw badRequest('ownershipProof is required to establish a new circle');
    }
    if (!body.timezone) {
      throw badRequest('timezone is required when establishing a new circle');
    }

    const proof = await verifyAndConsumeCircleCreateToken({
      token: body.ownershipProof,
      expectedUid: uid,
      expectedCircleId: circleId,
    });

    await bootstrapCircleOwnership({
      proof,
      displayName: body.displayName,
      timezone: body.timezone,
    });
    createdCircle = true;
    circle = await Circle.findOne({ circleId });
    if (!circle) {
      throw notFound('Circle not found after bootstrap');
    }
  }

  let member = await Member.findOne({ circleId, uid });

  if (!member) {
    if (circle.ownerUid === uid) {
      // Repair path: circle exists with this owner but member row missing.
      member = await Member.create({
        circleId,
        uid,
        role: 'owner',
        displayName: body.displayName,
        prefs: { ...DEFAULT_MEMBER_PREFS },
      });
    } else {
      // Open join-by-circleId is blocked — use POST /v1/circles/:circleId/join with inviteToken.
      throw forbidden('Not a member of this circle', {
        reason: 'JOIN_PROOF_REQUIRED',
        message:
          'Membership join requires POST /v1/circles/:circleId/join with a valid inviteToken; client role is ignored',
      });
    }
  } else {
    member.displayName = body.displayName;
    await member.save();
  }

  // Only the authoritative owner may update circle timezone.
  if (circle.ownerUid === uid && body.timezone) {
    circle.timezone = body.timezone;
    await circle.save();
  }

  await Device.findOneAndUpdate(
    { circleId, fcmToken: body.fcmToken },
    {
      $set: {
        uid,
        platform: body.platform,
      },
    },
    { upsert: true, returnDocument: 'after' },
  );

  const role: 'owner' | 'member' = circle.ownerUid === uid ? 'owner' : 'member';

  return {
    circleId,
    uid,
    role,
    displayName: body.displayName,
    platform: body.platform,
    fcmTokenRegistered: true,
    timezone: circle.timezone,
    createdCircle,
  };
}
