import 'package:cloud_firestore/cloud_firestore.dart';

import 'api_sync_queue.dart';
import 'care_circle_backend_client.dart';
import 'circle_bootstrap_service.dart';

/// Hooks for the host app — call from existing repositories without UI changes.
class CareCircleIntegrationCoordinator {
  CareCircleIntegrationCoordinator({
    required this.backend,
    required this.bootstrap,
    required this.sync,
    this.firestore,
  });

  final CareCircleBackendClient backend;
  final CircleBootstrapService bootstrap;
  final CareCircleSyncFacade sync;
  final FirebaseFirestore? firestore;

  /// New circle: trusted CF creates Firestore doc + returns bootstrap proof.
  Future<BootstrapResult> createCircleWithBootstrap({
    required String timezone,
    required String displayName,
    String? circleId,
  }) =>
      bootstrap.createCareCircle(
        timezone: timezone,
        displayName: displayName,
        circleId: circleId,
      );

  /// Existing Firestore circle: attest ownership then bootstrap backend Mongo.
  Future<BootstrapResult> bootstrapExistingFirestoreCircle({
    required String circleId,
    String? timezone,
  }) =>
      bootstrap.requestBootstrapToken(circleId: circleId, timezone: timezone);

  Future<void> registerDeviceForCircle({
    required String circleId,
    required String fcmToken,
    required String platform,
    required String displayName,
    String? timezone,
    String? ownershipProof,
  }) =>
      backend.registerDevice(
        circleId: circleId,
        fcmToken: fcmToken,
        platform: platform,
        displayName: displayName,
        timezone: timezone,
        ownershipProof: ownershipProof,
      );

  Future<Map<String, dynamic>> createMemberInvite({
    required String circleId,
    int? ttlSeconds,
  }) =>
      backend.createInvite(circleId: circleId, ttlSeconds: ttlSeconds);

  Future<void> acceptInviteAndRegisterDevice({
    required String circleId,
    required String inviteToken,
    required String displayName,
    required String fcmToken,
    required String platform,
    String? timezone,
  }) async {
    await backend.acceptInvite(
      circleId: circleId,
      inviteToken: inviteToken,
      displayName: displayName,
    );
    await registerDeviceForCircle(
      circleId: circleId,
      fcmToken: fcmToken,
      platform: platform,
      displayName: displayName,
      timezone: timezone,
    );
  }

  /// Mirror Firestore reminder doc to backend (queues on failure; Firestore write already succeeded).
  Future<void> syncReminderFromFirestore({
    required String circleId,
    required String module,
    required String itemId,
    required Map<String, dynamic> firestorePayload,
  }) async {
    try {
      await backend.upsertReminder(
        circleId: circleId,
        module: module,
        itemId: itemId,
        payload: firestorePayload,
      );
    } catch (_) {
      await sync.queueUpsertReminder(
        circleId: circleId,
        module: module,
        itemId: itemId,
        payload: firestorePayload,
      );
    }
  }

  Future<void> deleteReminderFromFirestore({
    required String circleId,
    required String module,
    required String itemId,
  }) async {
    try {
      await backend.deleteReminder(circleId: circleId, module: module, itemId: itemId);
    } catch (_) {
      await sync.queueDeleteReminder(circleId: circleId, module: module, itemId: itemId);
    }
  }

  /// One-time backfill: read `circles/{circleId}/reminders` and upsert each item.
  Future<int> backfillRemindersFromFirestore(String circleId) async {
    final db = firestore;
    if (db == null) {
      throw StateError('Firestore instance required for backfill');
    }
    final snap = await db.collection('circles').doc(circleId).collection('reminders').get();
    var count = 0;
    for (final doc in snap.docs) {
      final data = doc.data();
      final module = (data['module'] ?? data['type'] ?? 'medication').toString();
      await syncReminderFromFirestore(
        circleId: circleId,
        module: module,
        itemId: doc.id,
        firestorePayload: Map<String, dynamic>.from(data),
      );
      count += 1;
    }
    await sync.flushQueue();
    return count;
  }

  Future<void> deleteCircleBackendFirst(String circleId) async {
    await backend.deleteCircle(circleId: circleId);
  }

  Future<void> deleteAccountBackendFirst({String? circleId}) async {
    await backend.deleteAccount(circleId: circleId);
  }
}
