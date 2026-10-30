/**
 * Classify Firebase Admin Messaging errors for retry vs token cleanup.
 * Never treat configuration failures as invalid-device signals.
 */

export type FcmErrorClass =
  | 'invalid_token'
  | 'temporary'
  | 'permanent'
  | 'configuration';

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

const TEMPORARY_CODES = new Set([
  'messaging/unavailable',
  'messaging/internal-error',
  'messaging/server-unavailable',
  'messaging/quota-exceeded',
  'messaging/timeout',
  'messaging/message-rate-exceeded',
]);

const CONFIG_CODES = new Set([
  'messaging/third-party-auth-error',
  'messaging/mismatched-credential',
  'messaging/invalid-apns-credentials',
  'messaging/invalid-apns-package-name',
  'app/invalid-credential',
  'app/invalid-app-options',
]);

export function extractFcmErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const e = error as { code?: unknown; errorInfo?: { code?: unknown } };
  if (typeof e.code === 'string') {
    return e.code;
  }
  if (typeof e.errorInfo?.code === 'string') {
    return e.errorInfo.code;
  }
  return undefined;
}

export function classifyFcmError(error: unknown): FcmErrorClass {
  const code = extractFcmErrorCode(error);
  if (code && INVALID_TOKEN_CODES.has(code)) {
    // invalid-argument can be payload OR token; treat as invalid token only when message hints token.
    if (code === 'messaging/invalid-argument') {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (
        message.includes('token') ||
        message.includes('registration') ||
        message.includes('not a valid fcm')
      ) {
        return 'invalid_token';
      }
      return 'permanent';
    }
    return 'invalid_token';
  }
  if (code && CONFIG_CODES.has(code)) {
    return 'configuration';
  }
  if (code && TEMPORARY_CODES.has(code)) {
    return 'temporary';
  }
  // Unknown codes: prefer temporary so we do not burn the job permanently on oddities.
  if (code?.startsWith('messaging/')) {
    return 'temporary';
  }
  return 'temporary';
}

export function isInvalidTokenError(error: unknown): boolean {
  return classifyFcmError(error) === 'invalid_token';
}
