import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { getEnv } from '../../config/env.js';
import { badRequest, conflict, forbidden, serviceUnavailable } from '../../shared/errors/AppError.js';
import { CircleInvite } from './circleInvite.model.js';

export type CircleInvitePayload = {
  typ: 'circle_invite';
  jti: string;
  circleId: string;
  inviterUid: string;
  iat: number;
  exp: number;
};

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function parseBase64urlJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function signPayload(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function requireInviteSecret(): string {
  // Reuse create-token secret so ops manages one HMAC material; invites are typed separately.
  const secret = getEnv().CIRCLE_CREATE_TOKEN_SECRET;
  if (!secret) {
    throw serviceUnavailable(
      'Circle invite tokens unavailable: CIRCLE_CREATE_TOKEN_SECRET is not configured',
    );
  }
  return secret;
}

export async function signCircleInviteToken(input: {
  circleId: string;
  inviterUid: string;
  jti?: string;
  ttlSeconds?: number;
  nowSeconds?: number;
}): Promise<string> {
  const secret = requireInviteSecret();
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxTtl = getEnv().CIRCLE_INVITE_TOKEN_MAX_TTL_SECONDS;
  const ttl = Math.min(input.ttlSeconds ?? Math.min(maxTtl, 86_400), maxTtl);
  if (ttl <= 0) {
    throw badRequest('ttlSeconds must be positive');
  }

  const payload: CircleInvitePayload = {
    typ: 'circle_invite',
    jti: input.jti ?? randomUUID(),
    circleId: input.circleId,
    inviterUid: input.inviterUid,
    iat: now,
    exp: now + ttl,
  };

  await CircleInvite.create({
    jti: payload.jti,
    circleId: payload.circleId,
    inviterUid: payload.inviterUid,
    expiresAt: new Date(payload.exp * 1000),
  });

  const payloadB64 = base64urlJson(payload);
  return `${payloadB64}.${signPayload(payloadB64, secret)}`;
}

function parseAndVerify(token: string, secret: string): CircleInvitePayload {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw forbidden('Invalid invite token format');
  }
  const [payloadB64, signature] = parts;
  if (!safeEqual(signature, signPayload(payloadB64, secret))) {
    throw forbidden('Invalid invite token signature');
  }
  let parsed: unknown;
  try {
    parsed = parseBase64urlJson(payloadB64);
  } catch {
    throw forbidden('Invalid invite token payload');
  }
  const p = parsed as CircleInvitePayload;
  if (
    !p ||
    p.typ !== 'circle_invite' ||
    typeof p.jti !== 'string' ||
    typeof p.circleId !== 'string' ||
    typeof p.inviterUid !== 'string' ||
    typeof p.iat !== 'number' ||
    typeof p.exp !== 'number'
  ) {
    throw forbidden('Invalid invite token claims');
  }
  return p;
}

export async function verifyAndConsumeCircleInviteToken(input: {
  token: string;
  expectedCircleId: string;
  nowSeconds?: number;
}): Promise<CircleInvitePayload> {
  const secret = requireInviteSecret();
  const payload = parseAndVerify(input.token, secret);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxTtl = getEnv().CIRCLE_INVITE_TOKEN_MAX_TTL_SECONDS;

  if (payload.circleId !== input.expectedCircleId) {
    throw forbidden('Invite token circleId does not match path');
  }
  if (payload.exp < now) {
    throw forbidden('Invite token expired');
  }
  if (payload.iat > now + 60) {
    throw forbidden('Invite token issued in the future');
  }
  if (payload.exp - payload.iat > maxTtl) {
    throw forbidden('Invite token TTL exceeds allowed maximum');
  }

  // Atomic consume — missing row means revoked, expired (TTL), or already used.
  const consumed = await CircleInvite.findOneAndDelete({
    jti: payload.jti,
    circleId: payload.circleId,
  }).lean();

  if (!consumed) {
    throw conflict('Invite token has already been used or was revoked');
  }

  return payload;
}

/** Cascade helper — invalidate all unused invites for a circle. */
export async function invalidateInvitesForCircle(
  circleId: string,
  session?: import('mongoose').ClientSession | null,
): Promise<number> {
  const opts = session ? { session } : {};
  const result = await CircleInvite.deleteMany({ circleId }, opts);
  return result.deletedCount;
}
