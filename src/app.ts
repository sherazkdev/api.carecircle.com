import cors from 'cors';
import express, { type Request } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { getLogger } from './config/logger.js';
import { healthRouter } from './modules/health/health.routes.js';
import { v1Router } from './routes/v1.js';
import { errorHandler, notFoundHandler } from './shared/middleware/errorHandler.js';

export function createApp() {
  const app = express();
  const logger = getLogger();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req: Request) =>
          req.url === '/health' ||
          req.url === '/health/live' ||
          req.url === '/health/ready' ||
          req.url?.startsWith('/health?') === true,
      },
      serializers: {
        req(req: Request & { id?: string }) {
          return {
            id: req.id,
            method: req.method,
            url: req.url,
          };
        },
      },
    }),
  );

  app.use(healthRouter);
  app.use('/v1', v1Router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
