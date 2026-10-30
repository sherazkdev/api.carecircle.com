import mongoose from 'mongoose';
import { getEnv } from './env.js';
import { getLogger } from './logger.js';

export type MongoStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

let lastError: string | undefined;
let listenersAttached = false;

export function getMongoStatus(): MongoStatus {
  switch (mongoose.connection.readyState) {
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    case 3:
      return 'disconnected';
    default:
      return lastError ? 'error' : 'disconnected';
  }
}

export function getMongoLastError(): string | undefined {
  return lastError;
}

function attachListeners(): void {
  if (listenersAttached) {
    return;
  }
  listenersAttached = true;
  const logger = getLogger();

  mongoose.connection.on('connected', () => {
    lastError = undefined;
    logger.info('MongoDB connected');
  });
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });
  mongoose.connection.on('error', (err: Error) => {
    lastError = err.message;
    logger.error({ err: { message: err.message, name: err.name } }, 'MongoDB connection error');
  });
}

export async function connectMongo(uri = getEnv().MONGODB_URI): Promise<typeof mongoose> {
  lastError = undefined;
  attachListeners();
  await mongoose.connect(uri);
  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
