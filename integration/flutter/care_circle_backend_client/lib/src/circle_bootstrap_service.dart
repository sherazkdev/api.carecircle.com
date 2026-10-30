import 'package:cloud_functions/cloud_functions.dart';

import 'care_circle_backend_client.dart';

/// Bridges Firestore circle ownership to backend P2 bootstrap tokens via Cloud Functions.
///
/// Never exposes issuer API key or HMAC secret to the app.
class CircleBootstrapService {
  CircleBootstrapService({
    FirebaseFunctions? functions,
    required this.backend,
    FirebaseFunctions Function()? functionsFactory,
  }) : _functions = functions ?? (functionsFactory?.call() ?? FirebaseFunctions.instance);

  final FirebaseFunctions _functions;
  final CareCircleBackendClient backend;

  /// Preferred for new circles — creates Firestore doc + returns ownershipProof.
  Future<BootstrapResult> createCareCircle({
    required String timezone,
    required String displayName,
    String? circleId,
  }) async {
    final callable = _functions.httpsCallable('createCareCircle');
    final res = await callable.call<Map<String, dynamic>>({
      'timezone': timezone,
      'displayName': displayName,
      if (circleId != null) 'circleId': circleId,
    });
    return BootstrapResult.fromMap(res.data);
  }

  /// Use when the app already wrote circles/{circleId} in Firestore.
  Future<BootstrapResult> requestBootstrapToken({
    required String circleId,
    String? timezone,
  }) async {
    final callable = _functions.httpsCallable('requestCircleBootstrapToken');
    final res = await callable.call<Map<String, dynamic>>({
      'circleId': circleId,
      if (timezone != null) 'timezone': timezone,
    });
    return BootstrapResult.fromMap(res.data);
  }

  /// Register device on backend after obtaining ownershipProof.
  Future<void> bootstrapBackendCircle({
    required String circleId,
    required String fcmToken,
    required String platform,
    required String displayName,
    required String timezone,
    String? ownershipProof,
  }) async {
    await backend.registerDevice(
      circleId: circleId,
      fcmToken: fcmToken,
      platform: platform,
      displayName: displayName,
      timezone: timezone,
      ownershipProof: ownershipProof,
    );
  }
}

class BootstrapResult {
  BootstrapResult({
    required this.circleId,
    required this.ownershipProof,
    required this.expiresInSeconds,
    this.created,
  });

  factory BootstrapResult.fromMap(Map<String, dynamic> map) {
    return BootstrapResult(
      circleId: map['circleId'] as String,
      ownershipProof: map['ownershipProof'] as String,
      expiresInSeconds: (map['expiresInSeconds'] as num).toInt(),
      created: map['created'] as bool?,
    );
  }

  final String circleId;
  final String ownershipProof;
  final int expiresInSeconds;
  final bool? created;
}
