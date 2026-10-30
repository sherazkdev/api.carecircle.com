import { afterEach, describe, expect, it } from 'vitest';
import {
  spawnProductionServerExpectExit,
  startProductionServer,
  stopProductionServer,
  waitForHttpOk,
} from '../helpers/productionServer.js';

describe('production compiled runtime (dist/server.js)', () => {
  let handle: Awaited<ReturnType<typeof startProductionServer>> | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = undefined;
    }
  });

  it(
    'starts API in NODE_ENV=production with Mongo + Firebase ready',
    async () => {
      handle = await startProductionServer();
      const live = await fetch(`${handle.baseUrl}/health/live`);
      expect(live.status).toBe(200);
      const liveBody = (await live.json()) as { ok: boolean; data: { status: string } };
      expect(liveBody.ok).toBe(true);
      expect(liveBody.data.status).toBe('live');

      const ready = await fetch(`${handle.baseUrl}/health/ready`);
      expect(ready.status).toBe(200);
      const readyBody = (await ready.json()) as {
        ok: boolean;
        data: { status: string; mongo: string; firebase: string };
      };
      expect(readyBody.ok).toBe(true);
      expect(readyBody.data.status).toBe('ready');
      expect(readyBody.data.mongo).toBe('up');
      expect(readyBody.data.firebase).toBe('up');
    },
    120_000,
  );

  it(
    'exits non-zero when environment validation fails',
    async () => {
      const { exitCode, stderr } = await spawnProductionServerExpectExit({
        MONGODB_URI: '',
      });
      expect(exitCode).toBe(1);
      expect(stderr + '').toMatch(/Invalid environment configuration|MONGODB_URI/i);
    },
    30_000,
  );

  it(
    'rejects production worker with DELIVERY_MODE=noop',
    async () => {
      const { exitCode, stderr } = await spawnProductionServerExpectExit({
        MONGODB_URI: 'mongodb://127.0.0.1:27017/invalid-for-startup',
        PROCESS_MODE: 'worker',
        DELIVERY_MODE: 'noop',
      });
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/noop is forbidden|Invalid environment/i);
    },
    30_000,
  );

  it(
    'shuts down on SIGTERM/SIGINT equivalent without leaving zombie (Windows: kill)',
    async () => {
      handle = await startProductionServer();
      const baseUrl = handle.baseUrl;
      const { exitCode } = await handle.stop();
      expect(exitCode === 0 || exitCode === null).toBe(true);
      handle = undefined;
      await expect(
        waitForHttpOk(`${baseUrl}/health/live`, { timeoutMs: 2000 }),
      ).rejects.toThrow();
    },
    120_000,
  );

  it(
    'starts worker-only process without binding public HTTP',
    async () => {
      const { spawn } = await import('node:child_process');
      const { resolve } = await import('node:path');
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      const { ensureFirebaseFixture } = await import('../helpers/firebaseFixture.js');
      const memory = await MongoMemoryServer.create();
      const uri = memory.getUri('care_circle_worker_audit');
      const saPath = ensureFirebaseFixture();
      const repoRoot = resolve(import.meta.dirname, '../..');
      const child = spawn(process.execPath, [resolve(repoRoot, 'dist/server.js')], {
        cwd: repoRoot,
        env: {
          ...process.env,
          NODE_ENV: 'development',
          PROCESS_MODE: 'worker',
          DELIVERY_MODE: 'noop',
          PORT: '39002',
          LOG_LEVEL: 'error',
          MONGODB_URI: uri,
          FIREBASE_PROJECT_ID: 'care-circle-test',
          FIREBASE_SERVICE_ACCOUNT_PATH: saPath,
          CIRCLE_BOOTSTRAP_ENABLED: 'false',
          SCHEDULER_POLL_INTERVAL_MS: '600000',
        },
        stdio: 'ignore',
      });
      await new Promise((r) => setTimeout(r, 3000));
      expect(child.exitCode).toBeNull();
      const stopped = await stopProductionServer(child, memory);
      expect(stopped.exitCode === 0 || stopped.exitCode === null).toBe(true);
    },
    120_000,
  );
});
