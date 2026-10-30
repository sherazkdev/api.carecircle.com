# Firebase — trusted circle ownership (C2)

Deploy **callable functions** and **Firestore rules** alongside the Care Circle backend.

## Trust model

1. **Firestore** is the app’s system of record for `circleId` and `ownerUid`.
2. Callable functions verify `request.auth.uid` matches `circles/{circleId}.ownerUid`.
3. Only then they call `POST /v1/internal/circle-create-tokens` with `CIRCLE_TOKEN_ISSUER_API_KEY` (Firebase Secret).
4. Flutter receives **`ownershipProof` only** — never the API key or `CIRCLE_CREATE_TOKEN_SECRET`.

Keep **`CIRCLE_BOOTSTRAP_ENABLED=false`** on the API until staging/production E2E passes, then enable intentionally.

## Functions

| Callable | Use |
|----------|-----|
| `createCareCircle` | Create Firestore circle + owner member + mint bootstrap token |
| `requestCircleBootstrapToken` | Existing Firestore circle → mint token for backend bootstrap |

## Configure (Firebase CLI)

```bash
cd firebase/functions
npm ci
npm run build
```

Set params/secrets (example):

```bash
firebase functions:secrets:set CIRCLE_TOKEN_ISSUER_API_KEY
firebase functions:config:set care_circle.api_base_url="https://your-api-host"
# Or use defineString CARE_CIRCLE_API_BASE_URL in .env.<project> for emulators
```

API must run with:

- `CIRCLE_TOKEN_ISSUER_ENABLED=true`
- `CIRCLE_CREATE_TOKEN_SECRET` shared with issuer signing (API env only)
- `CIRCLE_BOOTSTRAP_ENABLED=true` **only after** E2E verification

## Deploy

```bash
cd firebase
firebase deploy --only functions,firestore:rules
```

## Tests

```bash
cd firebase/functions
npm test
```

Emulator E2E with live API is **NOT TESTED** in CI until configured.
