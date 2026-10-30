import { getEnv } from '../../config/env.js';
import { getLogger } from '../../config/logger.js';
import {
  NoopDeliveryPort,
  markProductionFcmConfigured,
  setDeliveryPort,
} from '../../scheduler/delivery.js';
import { createFcmDeliveryPort } from './fcmDelivery.js';

/**
 * Wire the delivery port for API/worker processes.
 *
 * - DELIVERY_MODE=fcm (default): real FcmDeliveryPort; required in production workers.
 * - DELIVERY_MODE=noop: dry-run only; forbidden when NODE_ENV=production and worker runs.
 *
 * Tests should call setDeliveryPort(RecordingDeliveryPort|mock) themselves and typically
 * leave DELIVERY_MODE unset/noop via applyTestEnv.
 */
export function configureDeliveryPort(): void {
  const env = getEnv();
  const logger = getLogger();
  const runWorker = env.PROCESS_MODE === 'worker' || env.PROCESS_MODE === 'all';

  if (env.DELIVERY_MODE === 'noop') {
    if (env.NODE_ENV === 'production' && runWorker) {
      throw new Error(
        'DELIVERY_MODE=noop is forbidden for production workers — would silently discard notifications',
      );
    }
    setDeliveryPort(new NoopDeliveryPort());
    logger.warn({ deliveryMode: 'noop' }, 'Notification delivery using Noop port');
    return;
  }

  setDeliveryPort(createFcmDeliveryPort());
  markProductionFcmConfigured();
  logger.info({ deliveryMode: 'fcm' }, 'Notification delivery using FCM adapter');
}
