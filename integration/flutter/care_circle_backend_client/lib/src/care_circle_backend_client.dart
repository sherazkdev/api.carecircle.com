import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

typedef JsonMap = Map<String, dynamic>;

/// Base URL without trailing slash, e.g. https://api.example.com
class CareCircleBackendClient {
  CareCircleBackendClient({
    required this.baseUrl,
    required FirebaseAuth auth,
    http.Client? httpClient,
  })  : _auth = auth,
        _http = httpClient ?? http.Client();

  final String baseUrl;
  final FirebaseAuth _auth;
  final http.Client _http;

  Future<String> _idToken() async {
    final user = _auth.currentUser;
    if (user == null) {
      throw StateError('Not signed in');
    }
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) {
      throw StateError('Missing ID token');
    }
    return token;
  }

  Future<JsonMap> _request(
    String method,
    String path, {
    JsonMap? body,
    Map<String, String>? headers,
  }) async {
    final uri = Uri.parse('$baseUrl$path');
    final token = await _idToken();
    final res = await _http.send(
      http.Request(method, uri)
        ..headers.addAll({
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
          ...?headers,
        })
        ..body = body == null ? '' : jsonEncode(body),
    );
    final responseBody = await res.stream.bytesToString();
    final decoded = jsonDecode(responseBody.isEmpty ? '{}' : responseBody) as JsonMap;
    if (res.statusCode >= 400 || decoded['ok'] != true) {
      final err = decoded['error'];
      final message = err is Map ? err['message']?.toString() : 'HTTP ${res.statusCode}';
      throw CareCircleApiException(res.statusCode, message ?? 'Request failed', details: err);
    }
    return decoded['data'] as JsonMap? ?? {};
  }

  // --- Devices / bootstrap ---

  Future<JsonMap> registerDevice({
    required String circleId,
    required String fcmToken,
    required String platform,
    required String displayName,
    String? timezone,
    String? ownershipProof,
  }) =>
      _request('POST', '/v1/circles/$circleId/devices', body: {
        'fcmToken': fcmToken,
        'platform': platform,
        'displayName': displayName,
        if (timezone != null) 'timezone': timezone,
        if (ownershipProof != null) 'ownershipProof': ownershipProof,
      });

  // --- Invites / join ---

  Future<JsonMap> createInvite({
    required String circleId,
    int? ttlSeconds,
  }) =>
      _request('POST', '/v1/circles/$circleId/invites', body: {
        if (ttlSeconds != null) 'ttlSeconds': ttlSeconds,
      });

  Future<JsonMap> acceptInvite({
    required String circleId,
    required String inviteToken,
    required String displayName,
  }) =>
      _request('POST', '/v1/circles/$circleId/join', body: {
        'inviteToken': inviteToken,
        'displayName': displayName,
      });

  // --- Prefs ---

  Future<JsonMap> updatePrefs({
    required String circleId,
    required JsonMap prefs,
  }) =>
      _request('PUT', '/v1/circles/$circleId/members/me/prefs', body: prefs);

  // --- Reminders ---

  Future<JsonMap> upsertReminder({
    required String circleId,
    required String module,
    required String itemId,
    required JsonMap payload,
  }) =>
      _request('PUT', '/v1/circles/$circleId/reminders/$module/$itemId', body: payload);

  Future<JsonMap> deleteReminder({
    required String circleId,
    required String module,
    required String itemId,
  }) =>
      _request('DELETE', '/v1/circles/$circleId/reminders/$module/$itemId');

  Future<JsonMap> setMedicationCompletion({
    required String circleId,
    required String itemId,
    required String occurrenceKey,
    required bool completed,
  }) =>
      _request(
        'PUT',
        '/v1/circles/$circleId/reminders/medication/$itemId/completion',
        body: {'occurrenceKey': occurrenceKey, 'completed': completed},
      );

  Future<JsonMap> setAppointmentStatus({
    required String circleId,
    required String itemId,
    required String status,
  }) =>
      _request(
        'PUT',
        '/v1/circles/$circleId/reminders/appointment/$itemId/status',
        body: {'status': status},
      );

  Future<JsonMap> setTaskStatus({
    required String circleId,
    required String itemId,
    required String status,
  }) =>
      _request(
        'PUT',
        '/v1/circles/$circleId/reminders/task/$itemId/status',
        body: {'status': status},
      );

  // --- Updates ---

  Future<JsonMap> postUpdate({
    required String circleId,
    required String updateType,
    required String notes,
    String? idempotencyKey,
    String? senderName,
  }) =>
      _request(
        'POST',
        '/v1/circles/$circleId/updates',
        body: {
          'updateType': updateType,
          'notes': notes,
          if (senderName != null) 'senderName': senderName,
        },
        headers: idempotencyKey == null ? null : {'Idempotency-Key': idempotencyKey},
      );

  // --- Deletion ---

  Future<JsonMap> deleteCircle({required String circleId}) =>
      _request('DELETE', '/v1/circles/$circleId');

  Future<JsonMap> deleteAccount({String? circleId}) => _request(
        'DELETE',
        circleId == null ? '/v1/members/me' : '/v1/members/me?circleId=$circleId',
      );

  void close() => _http.close();
}

class CareCircleApiException implements Exception {
  CareCircleApiException(this.statusCode, this.message, {this.details});
  final int statusCode;
  final String message;
  final dynamic details;
  @override
  String toString() => 'CareCircleApiException($statusCode): $message';
}
