# Care Circle — wire into your existing Flutter app

The production Flutter UI lives **outside this repository**. Add a path dependency and call the coordinator from your **existing** repositories/services.

## 1. `pubspec.yaml`

```yaml
dependencies:
  care_circle_backend_client:
    path: ../care-circle-reminder-app/integration/flutter/care_circle_backend_client
```

Configure base URL via `--dart-define=CARE_CIRCLE_API_BASE_URL=https://staging-api.example.com` (never embed secrets).

## 2. Bootstrap at app startup (example)

```dart
final backend = CareCircleBackendClient(
  baseUrl: const String.fromEnvironment('CARE_CIRCLE_API_BASE_URL'),
  auth: FirebaseAuth.instance,
);
final bootstrap = CircleBootstrapService(backend: backend);
final sync = CareCircleSyncFacade(
  client: backend,
  store: JsonApiSyncQueueStore(
    readRaw: () async => prefs.getString('care_circle_api_queue'),
    writeRaw: (v) async => prefs.setString('care_circle_api_queue', v),
  ),
);
final integration = CareCircleIntegrationCoordinator(
  backend: backend,
  bootstrap: bootstrap,
  sync: sync,
  firestore: FirebaseFirestore.instance,
);
```

## 3. Hook points (preserve UI — change repository only)

| Your existing code | Call |
|--------------------|------|
| Circle create success | `createCircleWithBootstrap` **or** `bootstrapExistingFirestoreCircle` + `registerDeviceForCircle(..., ownershipProof: result.ownershipProof)` |
| `onTokenRefresh` | `registerDeviceForCircle` for each active `circleId` |
| Owner invite share | `createMemberInvite` → share `inviteToken` |
| Accept invite screen | `acceptInviteAndRegisterDevice` |
| Firestore reminder save | `syncReminderFromFirestore` |
| First login / migration | `backfillRemindersFromFirestore(circleId)` |
| Prefs toggle save | `backend.updatePrefs` (queue via sync on failure) |
| Post update | `backend.postUpdate` |
| Delete circle | `deleteCircleBackendFirst` then Firestore delete |
| Delete account | `deleteAccountBackendFirst` then `FirebaseAuth.instance.currentUser!.delete()` |

## 4. Staging flags

Keep API `CIRCLE_BOOTSTRAP_ENABLED=false` until staging E2E passes (`docs/staging-e2e-checklist.md`).

## 5. Security

- No `CIRCLE_TOKEN_ISSUER_API_KEY`, service account JSON, or HMAC secret in Flutter.
- Callable functions return `ownershipProof` only.
- Client `role` fields are ignored by the API.
