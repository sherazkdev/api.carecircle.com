import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ensureAllIndexes } from '../../src/shared/db/ensureIndexes.js';

let memory: MongoMemoryServer | undefined;

export async function startTestMongo(): Promise<string> {
  memory = await MongoMemoryServer.create();
  const uri = memory.getUri('care_circle_phase2_test');
  await mongoose.connect(uri);
  await ensureAllIndexes();
  return uri;
}

export async function stopTestMongo(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (memory) {
    await memory.stop();
    memory = undefined;
  }
}

export async function clearAllCollections(): Promise<void> {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}
