import { getMessaging, type Message, type Messaging } from 'firebase-admin/messaging';
import { isFirebaseInitialized } from '../../config/firebase.js';
import type { TokenMessage } from './fcmPayload.js';

export type FcmSendResponse = {
  success: boolean;
  messageId?: string;
  error?: unknown;
};

export type FcmBatchResult = {
  successCount: number;
  failureCount: number;
  responses: FcmSendResponse[];
};

/**
 * Injectable Messaging boundary — production uses Firebase Admin; tests inject a mock.
 */
export interface FcmClient {
  sendEach(messages: TokenMessage[]): Promise<FcmBatchResult>;
}

export class FirebaseAdminFcmClient implements FcmClient {
  private messaging(): Messaging {
    if (!isFirebaseInitialized()) {
      const err = new Error('Firebase Admin is not initialized');
      (err as { code?: string }).code = 'app/invalid-app-options';
      throw err;
    }
    return getMessaging();
  }

  async sendEach(messages: TokenMessage[]): Promise<FcmBatchResult> {
    if (messages.length === 0) {
      return { successCount: 0, failureCount: 0, responses: [] };
    }

    const payload: Message[] = messages.map((m) => ({
      token: m.token,
      data: m.data,
      android: { priority: 'high' },
      // Data-only: no top-level `notification` key (Flutter local rendering contract).
    }));

    try {
      const batch = await this.messaging().sendEach(payload);
      return {
        successCount: batch.successCount,
        failureCount: batch.failureCount,
        responses: batch.responses.map((r): FcmSendResponse => {
          if (r.success) {
            return r.messageId
              ? { success: true, messageId: r.messageId }
              : { success: true };
          }
          return r.error ? { success: false, error: r.error } : { success: false };
        }),
      };
    } catch (error) {
      // Global/config failure — surface as one error per message without claiming token invalidity.
      return {
        successCount: 0,
        failureCount: messages.length,
        responses: messages.map(() => ({ success: false, error })),
      };
    }
  }
}

export function createFirebaseAdminFcmClient(): FcmClient {
  return new FirebaseAdminFcmClient();
}
