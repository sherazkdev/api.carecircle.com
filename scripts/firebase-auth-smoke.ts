/**
 * Firebase Auth smoke against local Docker API. Prints HTTP status codes only.
 * Requires: FIREBASE_SERVICE_ACCOUNT_PATH, FIREBASE_WEB_API_KEY (or auto-fetch), optional FIREBASE_AUTH_TEST_UID
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { cert, deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { GoogleAuth } from 'google-auth-library';
import { connectMongo, disconnectMongo } from '../src/config/mongo.js';
import { Circle } from '../src/modules/circle/circle.model.js';
import { Member } from '../src/modules/member/member.model.js';

const BASE = process.env.AUTH_SMOKE_BASE_URL ?? 'http://127.0.0.1:1001';
const CIRCLE_ID = 'auth-smoke-circle-1';
const ROUTE = `/v1/circles/${CIRCLE_ID}/members/me/prefs`;
const SA_PATH =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ??
  resolve('firebase-service-account.json');

const execFileAsync = promisify(execFile);

function npxBin(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

const DEFAULT_PREFS = {
  medication: true,
  appointment: true,
  task: true,
  updates: true,
};

type CaseResult = { case: string; status: number; note?: string };

async function fetchWebApiKeyFromManagementApi(
  projectId: string,
  sa: { client_email: string; private_key: string },
): Promise<string | undefined> {
  try {
    const auth = new GoogleAuth({
      credentials: sa,
      scopes: ['https://www.googleapis.com/auth/firebase.readonly'],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token.token) return undefined;

    const appsRes = await fetch(
      `https://firebase.googleapis.com/v1beta1/projects/${projectId}/androidApps`,
      { headers: { Authorization: `Bearer ${token.token}` } },
    );
    if (!appsRes.ok) return undefined;
    const appsBody = (await appsRes.json()) as { apps?: Array<{ name?: string; appId?: string }> };
    const app = appsBody.apps?.[0];
    const appResourceName = app?.name;
    if (!appResourceName) return undefined;

    const cfgRes = await fetch(
      `https://firebase.googleapis.com/v1beta1/${appResourceName}/config`,
      { headers: { Authorization: `Bearer ${token.token}` } },
    );
    if (!cfgRes.ok) return undefined;
    const cfgBody = (await cfgRes.json()) as { configFileContents?: string };
    if (!cfgBody.configFileContents) return undefined;
    const jsonText = Buffer.from(cfgBody.configFileContents, 'base64').toString('utf8');
    const parsed = JSON.parse(jsonText) as {
      client?: Array<{ api_key?: Array<{ current_key?: string }> }>;
    };
    return parsed.client?.[0]?.api_key?.[0]?.current_key;
  } catch {
    return undefined;
  }
}

async function fetchWebApiKeyFromFirebaseCli(projectId: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      npxBin(),
      ['--yes', 'firebase-tools', 'apps:list', '--project', projectId, '--json'],
      {
        env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: SA_PATH },
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const list = JSON.parse(stdout) as {
      result?: Array<{ platform: string; appId: string }>;
    };
    const android = list.result?.find((a) => a.platform === 'ANDROID');
    if (!android?.appId) {
      return undefined;
    }
    const { stdout: cfgOut } = await execFileAsync(
      npxBin(),
      [
        '--yes',
        'firebase-tools',
        'apps:sdkconfig',
        'ANDROID',
        android.appId,
        '--project',
        projectId,
      ],
      {
        env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: SA_PATH },
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const cfg = JSON.parse(cfgOut) as {
      client?: Array<{ api_key?: Array<{ current_key?: string }> }>;
    };
    return cfg.client?.[0]?.api_key?.[0]?.current_key;
  } catch {
    return undefined;
  }
}

async function fetchWebApiKey(projectId: string, sa: object): Promise<string | undefined> {
  if (process.env.FIREBASE_WEB_API_KEY?.trim()) {
    return process.env.FIREBASE_WEB_API_KEY.trim();
  }
  const fromMgmt = await fetchWebApiKeyFromManagementApi(
    projectId,
    sa as { client_email: string; private_key: string },
  );
  if (fromMgmt) {
    return fromMgmt;
  }
  const fromCli = await fetchWebApiKeyFromFirebaseCli(projectId);
  if (fromCli) {
    return fromCli;
  }
  try {
    const auth = new GoogleAuth({
      credentials: sa as { client_email: string; private_key: string },
      scopes: ['https://www.googleapis.com/auth/firebase.readonly'],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token.token) return undefined;
    const res = await fetch(
      `https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps`,
      { headers: { Authorization: `Bearer ${token.token}` } },
    );
    if (!res.ok) return undefined;
    const body = (await res.json()) as { apps?: Array<{ appId?: string }> };
    const appId = body.apps?.[0]?.appId;
    if (!appId) return undefined;
    const cfgRes = await fetch(
      `https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps/${appId}/config`,
      { headers: { Authorization: `Bearer ${token.token}` } },
    );
    if (!cfgRes.ok) return undefined;
    const cfg = (await cfgRes.json()) as { apiKey?: string };
    return cfg.apiKey;
  } catch {
    return undefined;
  }
}

async function exchangeCustomToken(customToken: string, webApiKey: string): Promise<string> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${webApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  if (!res.ok) {
    throw new Error(`custom_token_exchange_failed status=${res.status}`);
  }
  const data = (await res.json()) as { idToken?: string };
  if (!data.idToken) {
    throw new Error('custom_token_exchange_missing_id_token');
  }
  return data.idToken;
}

async function signInWithPassword(
  email: string,
  password: string,
  webApiKey: string,
): Promise<string> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${webApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`password_sign_in_failed status=${res.status}`);
  }
  const data = (await res.json()) as { idToken?: string };
  if (!data.idToken) {
    throw new Error('password_sign_in_missing_id_token');
  }
  return data.idToken;
}

async function putPrefs(authHeader?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader) {
    headers.Authorization = authHeader;
  }
  return fetch(`${BASE}${ROUTE}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(DEFAULT_PREFS),
  });
}

async function resolveTestUid(preferred?: string): Promise<string> {
  if (preferred?.trim()) return preferred.trim();
  const auth = getAuth();
  const page = await auth.listUsers(10);
  const user = page.users.find((u) => !u.disabled) ?? page.users[0];
  if (!user?.uid) {
    throw new Error('no_firebase_auth_users_in_project');
  }
  return user.uid;
}

async function seedMembershipForUid(uid: string): Promise<void> {
  const mongoUri =
    process.env.AUTH_SMOKE_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/care_circle';
  await connectMongo(mongoUri);
  await Circle.updateOne(
    { circleId: CIRCLE_ID },
    { $set: { circleId: CIRCLE_ID, ownerUid: uid, timezone: 'Asia/Karachi' } },
    { upsert: true },
  );
  await Member.updateOne(
    { circleId: CIRCLE_ID, uid },
    {
      $set: {
        circleId: CIRCLE_ID,
        uid,
        role: 'owner',
        displayName: 'Auth Smoke Tester',
        prefs: DEFAULT_PREFS,
      },
    },
    { upsert: true },
  );
  await disconnectMongo();
}

async function main(): Promise<void> {
  const saRaw = readFileSync(SA_PATH, 'utf8');
  const sa = JSON.parse(saRaw) as { project_id: string; client_email: string; private_key: string };
  const projectId = sa.project_id;

  for (const app of getApps()) {
    await deleteApp(app);
  }
  initializeApp({ credential: cert(sa), projectId });

  const noToken = await putPrefs();
  const invalid = await putPrefs('Bearer not-a-valid-firebase-jwt');

  const results: CaseResult[] = [
    { case: 'no_token', status: noToken.status },
    { case: 'invalid_token', status: invalid.status },
  ];

  let validStatus = 0;
  let validNote: string | undefined;
  let blocked: string | undefined;

  try {
    const webApiKey = await fetchWebApiKey(projectId, sa);
    if (!webApiKey) {
      blocked =
        'Set FIREBASE_WEB_API_KEY (Firebase Console → Project settings → General → Web API Key) or grant service account firebase.readonly to auto-fetch.';
    } else {
      const uid = await resolveTestUid(process.env.FIREBASE_AUTH_TEST_UID);
      await seedMembershipForUid(uid);

      let idToken: string;
      const email = process.env.FIREBASE_AUTH_TEST_EMAIL?.trim();
      const password = process.env.FIREBASE_AUTH_TEST_PASSWORD?.trim();
      if (email && password) {
        idToken = await signInWithPassword(email, password, webApiKey);
      } else {
        const customToken = await getAuth().createCustomToken(uid);
        idToken = await exchangeCustomToken(customToken, webApiKey);
      }

      const validRes = await putPrefs(`Bearer ${idToken}`);
      validStatus = validRes.status;
      const body = (await validRes.json()) as { ok?: boolean; error?: { code?: string; message?: string } };
      if (validRes.status === 200 && body.ok) {
        validNote = 'auth_ok_prefs_upsert_ok';
      } else if (validRes.status === 401) {
        validNote = 'auth_rejected_check_api_project_and_sa_match';
      } else if (validRes.status === 403) {
        validNote = `auth_ok_authorization_failed:${body.error?.code ?? 'FORBIDDEN'}`;
      } else if (validRes.status === 404) {
        validNote = `auth_ok_membership_or_circle:${body.error?.code ?? 'NOT_FOUND'}`;
      } else {
        validNote = `auth_ok_route:${body.error?.code ?? validRes.status}`;
      }
    }
  } catch (err) {
    blocked = err instanceof Error ? err.message : 'valid_token_blocked';
  }

  results.push({
    case: 'valid_token',
    status: validStatus,
    note: blocked ?? validNote,
  });

  console.log(
    JSON.stringify(
      {
        route: `PUT ${ROUTE}`,
        routeNote:
          'No protected GET routes in API; PUT member prefs is membership-gated and idempotent (read-equivalent prefs sync).',
        projectId,
        circleId: CIRCLE_ID,
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ fatal: message }));
  process.exit(1);
});
