import { createApp } from './app.js';
import { getEnv } from './config/env.js';
import { initFirebase } from './config/firebase.js';
import { getLogger } from './config/logger.js';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { configureDeliveryPort } from './modules/notification/configureDelivery.js';
import { ensureAllIndexes } from './shared/db/ensureIndexes.js';
import { startSchedulerWorker, stopSchedulerWorker } from './scheduler/worker.js';

async function main(): Promise<void> {
  const env = getEnv();
  const logger = getLogger();

  initFirebase();
  await connectMongo();
  await ensureAllIndexes();
  logger.info('MongoDB indexes verified');
  configureDeliveryPort();

  const runApi = env.PROCESS_MODE === 'api' || env.PROCESS_MODE === 'all';
  const runWorker = env.PROCESS_MODE === 'worker' || env.PROCESS_MODE === 'all';

  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;

  if (runApi) {
    const app = createApp();
    server = app.listen(env.PORT, () => {
      logger.info(
        { port: env.PORT, mode: env.PROCESS_MODE, nodeEnv: env.NODE_ENV },
        'Care Circle API listening',
      );
    });
  }

  if (runWorker) {
    startSchedulerWorker();
  }

  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');

    await stopSchedulerWorker();

    const finish = async (closeErr?: Error) => {
      try {
        await disconnectMongo();
      } catch (err) {
        logger.error(
          { err: { message: err instanceof Error ? err.message : 'unknown' } },
          'Mongo disconnect error during shutdown',
        );
      }
      process.exit(closeErr ? 1 : 0);
    };

    if (server) {
      server.close((closeErr) => {
        if (closeErr) {
          logger.error({ err: { message: closeErr.message } }, 'HTTP server close error');
        }
        void finish(closeErr ?? undefined);
      });
    } else {
      await finish();
    }

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'Startup failed';
  // Logger may not be usable if env failed; fall back to console for bootstrap errors.
  console.error(JSON.stringify({ level: 'error', msg: 'Fatal startup error', err: message }));
  process.exit(1);
});
