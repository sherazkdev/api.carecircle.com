import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import 'api_sync_queue.dart';
import 'care_circle_backend_client.dart';
import 'care_circle_integration_coordinator.dart';
import 'circle_bootstrap_service.dart';

typedef SyncFailureHandler = void Function(SyncFailure failure);

class SyncFailure {
  SyncFailure({
    required this.operation,
    required this.error,
    required this.willRetry,
    this.circleId,
  });

  final String operation;
  final Object error;
  final bool willRetry;
  final String? circleId;
}

/// Factory for app-wide backend integration (register in GetIt / Provider at startup).
class CareCircleBackendIntegration {
  CareCircleBackendIntegration._({
    required this.client,
    required this.bootstrap,
    required this.sync,
    required this.coordinator,
    this.onSyncFailure,
  });

  final CareCircleBackendClient client;
  final CircleBootstrapService bootstrap;
  final CareCircleSyncFacade sync;
  final CareCircleIntegrationCoordinator coordinator;
  final SyncFailureHandler? onSyncFailure;

  static CareCircleBackendIntegration create({
    required String apiBaseUrl,
    FirebaseAuth? auth,
    FirebaseFirestore? firestore,
    ApiSyncQueueStore? queueStore,
    SyncFailureHandler? onSyncFailure,
  }) {
    final client = CareCircleBackendClient(
      baseUrl: apiBaseUrl,
      auth: auth ?? FirebaseAuth.instance,
    );
    final bootstrap = CircleBootstrapService(backend: client);
    final sync = CareCircleSyncFacade(
      client: client,
      store: queueStore ?? InMemoryApiSyncQueueStore(),
    );
    final coordinator = CareCircleIntegrationCoordinator(
      backend: client,
      bootstrap: bootstrap,
      sync: sync,
      firestore: firestore ?? FirebaseFirestore.instance,
    );
    return CareCircleBackendIntegration._(
      client: client,
      bootstrap: bootstrap,
      sync: sync,
      coordinator: coordinator,
      onSyncFailure: onSyncFailure,
    );
  }

  /// Call on app resume / connectivity restored.
  Future<int> flushPendingSync() => sync.flushQueue();

  /// Register FCM for all active circles (token refresh handler).
  Future<void> registerFcmForCircles({
    required List<String> circleIds,
    required String fcmToken,
    required String displayName,
    required String platform,
    String? timezone,
  }) async {
    for (final circleId in circleIds) {
      await _runOrQueue(
        operation: 'registerDevice',
        circleId: circleId,
        run: () => coordinator.registerDeviceForCircle(
          circleId: circleId,
          fcmToken: fcmToken,
          platform: platform,
          displayName: displayName,
          timezone: timezone,
        ),
      );
    }
  }

  Future<void> _runOrQueue({
    required String operation,
    required Future<void> Function() run,
    String? circleId,
    Future<void> Function()? queue,
  }) async {
    try {
      await run();
    } catch (e) {
      if (queue != null) {
        await queue();
        onSyncFailure?.call(SyncFailure(
          operation: operation,
          error: e,
          willRetry: true,
          circleId: circleId,
        ));
        return;
      }
      onSyncFailure?.call(SyncFailure(
        operation: operation,
        error: e,
        willRetry: false,
        circleId: circleId,
      ));
      rethrow;
    }
  }

  Future<void> syncPrefs({
    required String circleId,
    required Map<String, dynamic> prefs,
  }) =>
      _runOrQueue(
        operation: 'updatePrefs',
        circleId: circleId,
        run: () => client.updatePrefs(circleId: circleId, prefs: prefs),
        queue: () => sync.queuePrefs(circleId: circleId, prefs: prefs),
      );

  Future<void> syncMedicationCompletion({
    required String circleId,
    required String itemId,
    required String occurrenceKey,
    required bool completed,
  }) =>
      _runOrQueue(
        operation: 'medicationCompletion',
        circleId: circleId,
        run: () => client.setMedicationCompletion(
          circleId: circleId,
          itemId: itemId,
          occurrenceKey: occurrenceKey,
          completed: completed,
        ),
        queue: () => sync.queueMedicationCompletion(
          circleId: circleId,
          itemId: itemId,
          occurrenceKey: occurrenceKey,
          completed: completed,
        ),
      );

  Future<void> syncAppointmentStatus({
    required String circleId,
    required String itemId,
    required String status,
  }) =>
      _runOrQueue(
        operation: 'appointmentStatus',
        circleId: circleId,
        run: () => client.setAppointmentStatus(circleId: circleId, itemId: itemId, status: status),
        queue: () => sync.queueAppointmentStatus(circleId: circleId, itemId: itemId, status: status),
      );

  Future<void> syncTaskStatus({
    required String circleId,
    required String itemId,
    required String status,
  }) =>
      _runOrQueue(
        operation: 'taskStatus',
        circleId: circleId,
        run: () => client.setTaskStatus(circleId: circleId, itemId: itemId, status: status),
        queue: () => sync.queueTaskStatus(circleId: circleId, itemId: itemId, status: status),
      );

  Future<void> syncUpdate({
    required String circleId,
    required String updateType,
    required String notes,
    String? idempotencyKey,
  }) =>
      _runOrQueue(
        operation: 'postUpdate',
        circleId: circleId,
        run: () => client.postUpdate(
          circleId: circleId,
          updateType: updateType,
          notes: notes,
          idempotencyKey: idempotencyKey,
        ),
        queue: () => sync.queueUpdate(
          circleId: circleId,
          updateType: updateType,
          notes: notes,
          idempotencyKey: idempotencyKey,
        ),
      );

  Future<void> syncDeleteReminder({
    required String circleId,
    required String module,
    required String itemId,
  }) =>
      _runOrQueue(
        operation: 'deleteReminder',
        circleId: circleId,
        run: () => client.deleteReminder(circleId: circleId, module: module, itemId: itemId),
        queue: () => sync.queueDeleteReminder(circleId: circleId, module: module, itemId: itemId),
      );
}
