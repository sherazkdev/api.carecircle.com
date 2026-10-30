# Care Circle Flutter application

Place the **production Flutter app** in this directory (or add a multi-root workspace folder) so agents can wire `care_circle_backend_client` into your existing repositories.

Expected layout:

```
mobile/app/
  pubspec.yaml          # dependencies: flutter + care_circle_backend_client (path: ../integration/flutter/...)
  lib/main.dart
  lib/...               # existing repos — hook per integration/flutter/APP_WIRING.md
```

**Current status:** No `pubspec.yaml` or `lib/main.dart` found under `mobile/` or elsewhere in this repository.
