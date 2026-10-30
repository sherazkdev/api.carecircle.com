import { getLogger } from '../../config/logger.js';
import { Circle } from '../circle/circle.model.js';
import { removeInvalidFcmToken } from '../device/device.service.js';
import type {
  DeliveryRecipient,
  DeliveryRequest,
  DeliveryResult,
  NotificationDeliveryPort,
} from '../../scheduler/delivery.js';
import { DeliveryAttempt, hashFcmToken } from './deliveryAttempt.model.js';
import { classifyFcmError, extractFcmErrorCode } from './fcmErrors.js';
import { createFirebaseAdminFcmClient, type FcmClient } from './fcmClient.js';
import {
  buildReminderFcmData,
  buildTokenMessage,
  buildUpdateFcmData,
  type FcmDataFields,
} from './fcmPayload.js';
import {
  DEFAULT_NOTIFICATION_TONE,
  renderNotificationTemplate,
  type ReminderTemplateInput,
} from './templates.js';

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

async function markAttempt(input: {
  jobId: string;
  circleId: string;
  uid: string;
  fcmToken: string;
  status: 'sent' | 'failed_temp' | 'failed_perm';
  fcmMessageId?: string;
  errorCode?: string;
}): Promise<void> {
  const tokenHash = hashFcmToken(input.fcmToken);
  const $set: Record<string, string> = {
    circleId: input.circleId,
    uid: input.uid,
    status: input.status,
  };
  if (input.fcmMessageId) {
    $set.fcmMessageId = input.fcmMessageId;
  }
  if (input.errorCode) {
    $set.errorCode = input.errorCode;
  }
  await DeliveryAttempt.findOneAndUpdate(
    { jobId: input.jobId, tokenHash },
    { $set },
    { upsert: true, returnDocument: 'after' },
  );
}

export type FcmDeliveryPortOptions = {
  client?: FcmClient;
};

/**
 * Production FCM adapter. Marks pushed=true only when at least one device was accepted by FCM
 * (including prior successful ledger entries on partial retry).
 */
export class FcmDeliveryPort implements NotificationDeliveryPort {
  private readonly client: FcmClient;

  constructor(options: FcmDeliveryPortOptions = {}) {
    this.client = options.client ?? createFirebaseAdminFcmClient();
  }

  async deliver(request: DeliveryRequest): Promise<DeliveryResult> {
    const logger = getLogger();
    const recipients = dedupeRecipients(request.recipients);
    if (recipients.length === 0) {
      return { ok: true, pushed: false, reason: 'no recipients after dedupe' };
    }

    let data: FcmDataFields;
    try {
      data = await this.buildDataPayload(request);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'template/payload build failed';
      logger.error({ jobId: request.jobId, err: { message } }, 'FCM payload build failed');
      return { ok: false, temporary: false, message };
    }

    const priorSent = await DeliveryAttempt.find({
      jobId: request.jobId,
      status: 'sent',
    }).lean();
    const alreadySent = new Set(priorSent.map((a) => a.tokenHash));

    const pending = recipients.filter((r) => !alreadySent.has(hashFcmToken(r.fcmToken)));
    if (pending.length === 0) {
      return { ok: true, pushed: true };
    }

    const messages = pending.map((r) => buildTokenMessage(r.fcmToken, data));
    const batch = await this.client.sendEach(messages);

    let newSuccesses = 0;
    let temporaryFailures = 0;
    let permanentFailures = 0;
    let configurationFailures = 0;
    const invalidTokens: string[] = [];

    for (let i = 0; i < pending.length; i++) {
      const recipient = pending[i]!;
      const response = batch.responses[i];
      if (!response) {
        temporaryFailures += 1;
        await markAttempt({
          jobId: request.jobId,
          circleId: request.circleId,
          uid: recipient.uid,
          fcmToken: recipient.fcmToken,
          status: 'failed_temp',
          errorCode: 'missing_response',
        });
        continue;
      }

      if (response.success) {
        newSuccesses += 1;
        await markAttempt({
          jobId: request.jobId,
          circleId: request.circleId,
          uid: recipient.uid,
          fcmToken: recipient.fcmToken,
          status: 'sent',
          ...(response.messageId ? { fcmMessageId: response.messageId } : {}),
        });
        continue;
      }

      const classification = classifyFcmError(response.error);
      const errorCode = extractFcmErrorCode(response.error) ?? classification;

      if (classification === 'invalid_token') {
        permanentFailures += 1;
        invalidTokens.push(recipient.fcmToken);
        await markAttempt({
          jobId: request.jobId,
          circleId: request.circleId,
          uid: recipient.uid,
          fcmToken: recipient.fcmToken,
          status: 'failed_perm',
          errorCode,
        });
        continue;
      }

      if (classification === 'configuration') {
        configurationFailures += 1;
        temporaryFailures += 1;
        await markAttempt({
          jobId: request.jobId,
          circleId: request.circleId,
          uid: recipient.uid,
          fcmToken: recipient.fcmToken,
          status: 'failed_temp',
          errorCode,
        });
        logger.error(
          { jobId: request.jobId, errorCode, type: request.type },
          'FCM configuration error — tokens not removed',
        );
        continue;
      }

      if (classification === 'permanent') {
        permanentFailures += 1;
        await markAttempt({
          jobId: request.jobId,
          circleId: request.circleId,
          uid: recipient.uid,
          fcmToken: recipient.fcmToken,
          status: 'failed_perm',
          errorCode,
        });
        continue;
      }

      temporaryFailures += 1;
      await markAttempt({
        jobId: request.jobId,
        circleId: request.circleId,
        uid: recipient.uid,
        fcmToken: recipient.fcmToken,
        status: 'failed_temp',
        errorCode,
      });
    }

    for (const token of invalidTokens) {
      try {
        await removeInvalidFcmToken(token);
      } catch (err) {
        logger.warn(
          {
            jobId: request.jobId,
            err: { message: err instanceof Error ? err.message : 'token cleanup failed' },
          },
          'failed to remove invalid FCM token',
        );
      }
    }

    const anySuccess = newSuccesses > 0 || alreadySent.size > 0;

    logger.info(
      {
        jobId: request.jobId,
        type: request.type,
        attempted: pending.length,
        newSuccesses,
        temporaryFailures,
        permanentFailures,
        configurationFailures,
        invalidTokenCount: invalidTokens.length,
        priorSuccesses: alreadySent.size,
      },
      'FCM delivery batch completed',
    );

    if (temporaryFailures > 0) {
      return {
        ok: false,
        temporary: true,
        message:
          configurationFailures > 0
            ? 'FCM configuration/temporary failure'
            : 'FCM temporary failure for one or more devices',
        ...(invalidTokens.length > 0 ? { invalidTokens } : {}),
      };
    }

    if (anySuccess) {
      return { ok: true, pushed: true };
    }

    // No successes: all permanent/invalid
    return {
      ok: false,
      temporary: false,
      message: 'FCM permanent failure for all devices',
      ...(invalidTokens.length > 0 ? { invalidTokens } : {}),
    };
  }

  private async buildDataPayload(request: DeliveryRequest): Promise<FcmDataFields> {
    const tone = request.tone?.trim() || DEFAULT_NOTIFICATION_TONE;

    if (request.type === 'update_new') {
      const rendered = renderNotificationTemplate({
        type: 'update_new',
        senderDisplayName: request.senderDisplayName ?? 'Someone',
        notes: request.notes ?? '',
      });
      return buildUpdateFcmData({
        circleId: request.circleId,
        updateType: request.updateType ?? 'general',
        title: rendered.title,
        body: rendered.body,
        tone,
      });
    }

    const circle = await Circle.findOne({ circleId: request.circleId }).lean();
    const timezone = request.timezone ?? circle?.timezone ?? 'UTC';
    const scheduledAt = new Date(request.scheduledAtIso);

    const templateInput: ReminderTemplateInput = {
      type: request.type,
      itemTitle: request.titleHint ?? 'Reminder',
      scheduledAt,
      timezone,
      ...(typeof request.leadTimeMinutes === 'number'
        ? { leadTimeMinutes: request.leadTimeMinutes }
        : {}),
    };

    const rendered = renderNotificationTemplate(templateInput);
    return buildReminderFcmData({
      type: request.type,
      module: request.module,
      circleId: request.circleId,
      itemId: request.itemId,
      occurrenceKey: request.occurrenceKey,
      scheduledAt: request.scheduledAtIso,
      title: rendered.title,
      body: rendered.body,
      tone,
    });
  }
}

export function createFcmDeliveryPort(options?: FcmDeliveryPortOptions): FcmDeliveryPort {
  return new FcmDeliveryPort(options);
}
