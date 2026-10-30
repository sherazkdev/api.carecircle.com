/**
 * Calls the Care Circle API trusted issuer (server-side only).
 * Secrets: CARE_CIRCLE_API_BASE_URL, CIRCLE_TOKEN_ISSUER_API_KEY (Firebase params/secrets).
 */
export type MintBootstrapTokenInput = {
  circleId: string;
  ownerUid: string;
  timezone?: string;
  ttlSeconds?: number;
};

export type MintBootstrapTokenResult = {
  token: string;
  circleId: string;
  ownerUid: string;
  expiresInSeconds: number;
};

export type IssuerClientDeps = {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
};

export async function mintCircleBootstrapTokenViaApi(
  input: MintBootstrapTokenInput,
  deps: IssuerClientDeps,
): Promise<MintBootstrapTokenResult> {
  const fetchFn = deps.fetchImpl ?? fetch;
  const url = `${deps.baseUrl.replace(/\/$/, '')}/v1/internal/circle-create-tokens`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Issuer-Api-Key': deps.apiKey,
    },
    body: JSON.stringify({
      circleId: input.circleId,
      ownerUid: input.ownerUid,
      ...(input.timezone ? { timezone: input.timezone } : {}),
      ...(input.ttlSeconds !== undefined ? { ttlSeconds: input.ttlSeconds } : {}),
    }),
  });

  const body = (await res.json()) as {
    ok?: boolean;
    data?: MintBootstrapTokenResult & { token?: string };
    error?: { message?: string };
  };

  if (!res.ok || !body.ok || !body.data?.token) {
    const msg = body.error?.message ?? `Issuer HTTP ${res.status}`;
    throw new Error(`Circle bootstrap issuer failed: ${msg}`);
  }

  return {
    token: body.data.token,
    circleId: body.data.circleId,
    ownerUid: body.data.ownerUid,
    expiresInSeconds: body.data.expiresInSeconds,
  };
}
