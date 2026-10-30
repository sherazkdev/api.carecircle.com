import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ensureFirebaseFixture } from './firebaseFixture.js';

const repoRoot = resolve(import.meta.dirname, '../..');

export type ProductionServerHandle = {
  port: number;
  baseUrl: string;
  child: ChildProcess;
  memory: MongoMemoryServer;
  stop: () => Promise<{ exitCode: number | null }>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitForHttpOk(
  url: string,
  opts: { timeoutMs?: number; expectStatus?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const expectStatus = opts.expectStatus ?? 200;
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === expectStatus) {
        return;
      }
      lastErr = `status ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : 'fetch failed';
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url} (${expectStatus}): ${lastErr}`);
}

export async function startProductionServer(
  overrides: Record<string, string> = {},
): Promise<ProductionServerHandle> {
  const memory = await MongoMemoryServer.create();
  const uri = memory.getUri('care_circle_prod_audit');
  const saPath = ensureFirebaseFixture();
  const port = 38000 + Math.floor(Math.random() * 2000);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PROCESS_MODE: 'api',
    DELIVERY_MODE: 'fcm',
    PORT: String(port),
    LOG_LEVEL: 'error',
    MONGODB_URI: uri,
    FIREBASE_PROJECT_ID: 'care-circle-test',
    FIREBASE_SERVICE_ACCOUNT_PATH: saPath,
    CIRCLE_BOOTSTRAP_ENABLED: 'false',
    CIRCLE_TOKEN_ISSUER_ENABLED: 'false',
    CIRCLE_CREATE_TOKEN_SECRET: 'audit-circle-create-token-secret-min-32!',
    MISS_GRACE_MINUTES: '0',
    ...overrides,
  };

  delete env.FIREBASE_SERVICE_ACCOUNT_JSON;

  const child = spawn(process.execPath, [resolve(repoRoot, 'dist/server.js')], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await waitForHttpOk(`${baseUrl}/health/live`, { timeoutMs: 45_000 });
    await waitForHttpOk(`${baseUrl}/health/ready`, { timeoutMs: 45_000 });
  } catch (err) {
    child.kill();
    await memory.stop();
    throw err;
  }

  return {
    port,
    baseUrl,
    child,
    memory,
    stop: () => stopProductionServer(child, memory),
  };
}

export async function stopProductionServer(
  child: ChildProcess,
  memory: MongoMemoryServer,
): Promise<{ exitCode: number | null }> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      void memory.stop().finally(() => resolvePromise({ exitCode }));
    };

    child.once('exit', (code) => finish(code));

    if (process.platform === 'win32') {
      child.kill();
    } else {
      child.kill('SIGTERM');
    }

    setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
      finish(null);
    }, 15_000).unref();
  });
}

export function spawnProductionServerExpectExit(
  envOverrides: Record<string, string>,
  opts: { timeoutMs?: number } = {},
): Promise<{ exitCode: number | null; stderr: string }> {
  const saPath = ensureFirebaseFixture();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PROCESS_MODE: 'api',
    DELIVERY_MODE: 'fcm',
    PORT: '39999',
    LOG_LEVEL: 'error',
    FIREBASE_PROJECT_ID: 'care-circle-test',
    FIREBASE_SERVICE_ACCOUNT_PATH: saPath,
    CIRCLE_BOOTSTRAP_ENABLED: 'false',
    CIRCLE_TOKEN_ISSUER_ENABLED: 'false',
    ...envOverrides,
  };

  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [resolve(repoRoot, 'dist/server.js')], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const timeoutMs = opts.timeoutMs ?? 15_000;
    const timer = setTimeout(() => {
      child.kill();
      resolvePromise({ exitCode: null, stderr });
    }, timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code, stderr });
    });
  });
}
