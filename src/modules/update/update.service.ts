import { randomUUID } from 'node:crypto';
import { getLogger } from '../../config/logger.js';
import { getDeliveryPort, type DeliveryRecipient } from '../../scheduler/delivery.js';
import { Device } from '../device/device.model.js';
import { Member } from '../member/member.model.js';
import type { UpdateShareBody } from './update.schemas.js';
import {
  UpdateOutbox,
  type UpdateDeliveryStatus,
  type UpdateOutboxDocument,
} from './updateOutbox.model.js';

export type ShareUpdateResult = {
  updateId: string;
  circleId: string;
  updateType: string;
  senderUid: string;
  senderDisplayName: string;
  notes: string;
  idempotencyKey: string;
  delivery: {
    status: UpdateDeliveryStatus;
    /** True only when FCM accepted at least one device. */
    pushed: boolean;
    recipientDeviceCount: number;
    message?: string;
  };
  /** True when a prior terminal outbox row was returned (client retry). */
  replayed: boolean;
  /** Alias of replayed for clients preferring this name. */
  idempotentReplay: boolean;
};

function dedupeRecipients(recipients: DeliveryRecipient[]): DeliveryRecipient[] {
  const seen = new Set<string>();
  const out: DeliveryRecipient[] = [];
  for (const r of recipients) {
    if (seen.has(r.fcmToken)) {
      continue;
    }
    seen.add(r.fcmToken);
    out.push(r);
  }
  return out;
}

async function resolveUpdateRecipients(
  circleId: string,
  senderUid: string,
): Promise<DeliveryRecipient[]> {
  const members = await Member.find({ circleId }).lean();
  const recipients: DeliveryRecipient[] = [];

  for (const member of members) {
    if (member.uid === senderUid) {
      continue;
    }
    if (!member.prefs.updates) {
      continue;
    }
    const devices = await Device.find({ circleId, uid: member.uid }).lean();
    for (const device of devices) {
      recipients.push({
        uid: member.uid,
        fcmToken: device.fcmToken,
        platform: device.platform,
      });
    }
  }

  return dedupeRecipients(recipients);
}

function toResult(doc: UpdateOutboxDocument, replayed: boolean): ShareUpdateResult {
  const delivery: ShareUpdateResult['delivery'] = {
    status: doc.deliveryStatus,
    pushed: doc.deliveryStatus === 'sent',
    recipientDeviceCount: doc.recipientDeviceCount,
  };
  if (doc.lastError) {
    delivery.message = doc.lastError;
  }
  return {
    updateId: doc.updateId,
    circleId: doc.circleId,
    updateType: doc.updateType,
    senderUid: doc.senderUid,
    senderDisplayName: doc.senderDisplayName,
    notes: doc.notes,
    idempotencyKey: doc.idempotencyKey,
    delivery,
    replayed,
    idempotentReplay: replayed,
  };
}

function isDuplicateKeyError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: number }).code === 11000,
  );
}

function isTerminalStatus(status: UpdateDeliveryStatus): boolean {
  return status === 'sent' || status === 'no_recipients' || status === 'failed_perm';
}

/**
 * Share a circle update. Uses outbox + Idempotency-Key for retry-safe processing.
 * Never reports pushed=true unless the delivery port returned pushed success.
 */
export async function shareCircleUpdate(input: {
  circleId: string;
  senderUid: string;
  senderDisplayName: string;
  body: UpdateShareBody;
  idempotencyKey?: string;
}): Promise<ShareUpdateResult> {
  const logger = getLogger();
  const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();

  let outbox = await UpdateOutbox.findOne({
    circleId: input.circleId,
    idempotencyKey,
  });

  if (outbox && isTerminalStatus(outbox.deliveryStatus)) {
    return toResult(outbox, true);
  }

  let createdNow = false;
  if (!outbox) {
    try {
      outbox = await UpdateOutbox.create({
        updateId: randomUUID(),
        circleId: input.circleId,
        senderUid: input.senderUid,
        senderDisplayName: input.senderDisplayName,
        updateType: input.body.updateType,
        notes: input.body.notes,
        idempotencyKey,
        deliveryStatus: 'pending',
        recipientDeviceCount: 0,
      });
      createdNow = true;
    } catch (err) {
      if (!isDuplicateKeyError(err)) {
        throw err;
      }
      const raced = await UpdateOutbox.findOne({
        circleId: input.circleId,
        idempotencyKey,
      });
      if (!raced) {
        throw err;
      }
      if (isTerminalStatus(raced.deliveryStatus)) {
        return toResult(raced, true);
      }
      outbox = raced;
    }
  }

  const recipients = await resolveUpdateRecipients(input.circleId, input.senderUid);
  outbox.recipientDeviceCount = recipients.length;

  if (recipients.length === 0) {
    outbox.deliveryStatus = 'no_recipients';
    outbox.lastError = null;
    await outbox.save();
    return toResult(outbox, !createdNow);
  }

  const result = await getDeliveryPort().deliver({
    jobId: outbox.updateId,
    circleId: input.circleId,
    itemId: outbox.updateId,
    module: 'update',
    type: 'update_new',
    occurrenceKey: outbox.updateId,
    scheduledAtIso: new Date().toISOString(),
    audience: 'members_except_sender',
    updateType: outbox.updateType,
    senderDisplayName: outbox.senderDisplayName,
    notes: outbox.notes,
    tone: 'gentle_chime',
    recipients,
  });

  // replayed=true when this request reused an existing outbox (idempotent retry path)
  const replayed = !createdNow;

  if (result.ok && result.pushed) {
    outbox.deliveryStatus = 'sent';
    outbox.lastError = null;
    await outbox.save();
    logger.info(
      { updateId: outbox.updateId, circleId: input.circleId, devices: recipients.length },
      'circle update delivered',
    );
    return toResult(outbox, replayed);
  }

  if (result.ok && !result.pushed) {
    outbox.deliveryStatus = 'no_recipients';
    outbox.lastError = result.reason;
    await outbox.save();
    return toResult(outbox, replayed);
  }

  if (!result.ok && result.temporary) {
    outbox.deliveryStatus = 'failed_temp';
    outbox.lastError = result.message;
    await outbox.save();
    return toResult(outbox, replayed);
  }

  outbox.deliveryStatus = 'failed_perm';
  outbox.lastError = !result.ok ? result.message : 'delivery failed';
  await outbox.save();
  return toResult(outbox, replayed);
}
