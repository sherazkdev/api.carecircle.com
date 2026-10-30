import type { NotificationType, ReminderModule } from '../shared/types/domain.js';

/**
 * Delivery guarantee: at-least-once from the worker's perspective.
 * A crash between successful external send and DB acknowledgement may duplicate.
 * Per-device ledger (delivery_attempts) avoids resending to tokens already accepted by FCM.
 */
export type DeliveryRecipient = {
  uid: string;
  fcmToken: string;
  platform: string;
};

export type DeliveryRequest = {
  jobId: string;
  circleId: string;
  itemId: string;
  module: ReminderModule | 'update';
  type: NotificationType;
  occurrenceKey: string;
  scheduledAtIso: string;
  audience: string;
  tone?: string;
  /** Reminder item title for Spec §9 templates — never client notification copy. */
  titleHint?: string;
  /** Circle IANA timezone for local time formatting. */
  timezone?: string;
  /** Required for *_before templates. */
  leadTimeMinutes?: number;
  /** update_new fields (Phase 8 trigger; Phase 7 payload support). */
  updateType?: string;
  senderDisplayName?: string;
  notes?: string;
  recipients: DeliveryRecipient[];
};

/**
 * `pushed: true` — FCM accepted at least one device (or prior ledger successes cover all).
 * `pushed: false` — Noop / no recipients; must not mark job `sent`.
 */
export type DeliveryResult =
  | { ok: true; pushed: true }
  | { ok: true; pushed: false; reason: string }
  | { ok: false; temporary: boolean; message: string; invalidTokens?: string[] };

export interface NotificationDeliveryPort {
  deliver(request: DeliveryRequest): Promise<DeliveryResult>;
}

/**
 * Isolated tests / explicit dry-run only.
 * Production workers must use FcmDeliveryPort — see configureDeliveryPort().
 */
export class NoopDeliveryPort implements NotificationDeliveryPort {
  async deliver(_request: DeliveryRequest): Promise<DeliveryResult> {
    return {
      ok: true,
      pushed: false,
      reason: 'noop delivery port — no FCM send',
    };
  }
}

/** Test double that records deliveries and simulates a successful push by default. */
export class RecordingDeliveryPort implements NotificationDeliveryPort {
  readonly requests: DeliveryRequest[] = [];
  nextResult: DeliveryResult = { ok: true, pushed: true };

  async deliver(request: DeliveryRequest): Promise<DeliveryResult> {
    this.requests.push(request);
    return this.nextResult;
  }

  reset(): void {
    this.requests.length = 0;
    this.nextResult = { ok: true, pushed: true };
  }
}

let deliveryPort: NotificationDeliveryPort = new NoopDeliveryPort();
let productionFcmConfigured = false;

export function getDeliveryPort(): NotificationDeliveryPort {
  return deliveryPort;
}

export function setDeliveryPort(port: NotificationDeliveryPort): void {
  deliveryPort = port;
  productionFcmConfigured = false;
}

export function resetDeliveryPort(): void {
  deliveryPort = new NoopDeliveryPort();
  productionFcmConfigured = false;
}

export function isProductionFcmDeliveryConfigured(): boolean {
  return productionFcmConfigured;
}

/** Mark that the live FCM adapter is installed (called from configureDeliveryPort). */
export function markProductionFcmConfigured(): void {
  productionFcmConfigured = true;
}
