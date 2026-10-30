import 'dart:convert';

import 'care_circle_backend_client.dart';

/// Persistent queue for failed backend mutations (implement with shared_preferences / hive in app).
abstract class ApiSyncQueueStore {
  Future<List<QueuedApiRequest>> loadAll();
  Future<void> saveAll(List<QueuedApiRequest> items);
}

class QueuedApiRequest {
  QueuedApiRequest({
    required this.id,
    required this.method,
    required this.path,
    required this.body,
    required this.createdAt,
    this.headers = const {},
    this.attempts = 0,
  });

  factory QueuedApiRequest.fromJson(Map<String, dynamic> json) {
    return QueuedApiRequest(
      id: json['id'] as String,
      method: json['method'] as String,
      path: json['path'] as String,
      body: json['body'] as Map<String, dynamic>?,
      headers: Map<String, String>.from(json['headers'] as Map? ?? {}),
      createdAt: DateTime.parse(json['createdAt'] as String),
      attempts: (json['attempts'] as num?)?.toInt() ?? 0,
    );
  }

  final String id;
  final String method;
  final String path;
  final Map<String, dynamic>? body;
  final Map<String, String> headers;
  final DateTime createdAt;
  final int attempts;

  Map<String, dynamic> toJson() => {
        'id': id,
        'method': method,
        'path': path,
        'body': body,
        'headers': headers,
        'createdAt': createdAt.toIso8601String(),
        'attempts': attempts,
      };

  QueuedApiRequest copyWith({int? attempts}) => QueuedApiRequest(
        id: id,
        method: method,
        path: path,
        body: body,
        headers: headers,
        createdAt: createdAt,
        attempts: attempts ?? this.attempts,
      );
}

class InMemoryApiSyncQueueStore implements ApiSyncQueueStore {
  List<QueuedApiRequest> _items = [];

  @override
  Future<List<QueuedApiRequest>> loadAll() async => List.from(_items);

  @override
  Future<void> saveAll(List<QueuedApiRequest> items) async {
    _items = List.from(items);
  }
}

/// Retry-safe queue with dedupe by [QueuedApiRequest.id] (idempotent upserts coalesce).
class CareCircleSyncFacade {
  CareCircleSyncFacade({
    required this.client,
    required ApiSyncQueueStore store,
    this.maxAttempts = 8,
  }) : _store = store;

  final CareCircleBackendClient client;
  final ApiSyncQueueStore _store;
  final int maxAttempts;

  Future<void> _enqueue(QueuedApiRequest item) async {
    final items = await _load();
    items.removeWhere((e) => e.id == item.id);
    items.add(item);
    await _persist(items);
  }

  Future<void> queueUpsertReminder({
    required String circleId,
    required String module,
    required String itemId,
    required Map<String, dynamic> payload,
  }) =>
      _enqueue(
        QueuedApiRequest(
          id: 'upsert:$circleId:$module:$itemId',
          method: 'PUT',
          path: '/v1/circles/$circleId/reminders/$module/$itemId',
          body: payload,
          createdAt: DateTime.now().toUtc(),
        ),
      );

  Future<void> queueDeleteReminder({
    required String circleId,
    required String module,
    required String itemId,
  }) =>
      _enqueue(
        QueuedApiRequest(
          id: 'delete:$circleId:$module:$itemId',
          method: 'DELETE',
          path: '/v1/circles/$circleId/reminders/$module/$itemId',
          createdAt: DateTime.now().toUtc(),
        ),
      );

  Future<void> queuePrefs({
    required String circleId,
    required Map<String, dynamic> prefs,
  }) =>
      _enqueue(
        QueuedApiRequest(
          id: 'prefs:$circleId',
          method: 'PUT',
          path: '/v1/circles/$circleId/members/me/prefs',
          body: prefs,
          createdAt: DateTime.now().toUtc(),
        ),
      );

  Future<void> queueMedicationCompletion({
    required String circleId,
    required String itemId,
    required String occurrenceKey,
    required bool completed,
  }) =>
      _enqueue(
        QueuedApiRequest(
          id: 'completion:$circleId:$itemId:$occurrenceKey',
          method: 'PUT',
          path: '/v1/circles/$circleId/reminders/medication/$itemId/completion',
          body: {'occurrenceKey': occurrenceKey, 'completed': completed},
          createdAt: DateTime.now().toUtc(),
        ),
      );

  Future<void> queueAppointmentStatus({
    required String circleId,
    required String itemId,
    required String status,
  }) =>
      _enqueue(
        QueuedApiRequest(
          id: 'appt-status:$circleId:$itemId',
          method: 'PUT',
          path: '/v1/circles/$circleId/reminders/appointment/$itemId/status',
          body: {'status': status},
          createdAt: DateTime.now().toUtc(),
        ),
      );

  Future<void> queueTaskStatus({
    required String circleId,
    required String itemId,
    required String status,
  }) =>
      _enqueue(
        QueuedApiRequest(
          id: 'task-status:$circleId:$itemId',
          method: 'PUT',
          path: '/v1/circles/$circleId/reminders/task/$itemId/status',
          body: {'status': status},
          createdAt: DateTime.now().toUtc(),
        ),
      );

  Future<void> queueUpdate({
    required String circleId,
    required String updateType,
    required String notes,
    String? idempotencyKey,
  }) =>
      _enqueue(
        QueuedApiRequest(
          id: 'update:$circleId:${idempotencyKey ?? updateType}',
          method: 'POST',
          path: '/v1/circles/$circleId/updates',
          body: {'updateType': updateType, 'notes': notes},
          headers: idempotencyKey == null ? const {} : {'Idempotency-Key': idempotencyKey},
          createdAt: DateTime.now().toUtc(),
        ),
      );

  Future<int> flushQueue() async {
    final items = await _load();
    if (items.isEmpty) return 0;

    final remaining = <QueuedApiRequest>[];
    var ok = 0;

    for (final item in items) {
      try {
        await _dispatch(item);
        ok += 1;
      } on CareCircleApiException catch (e) {
        if (e.statusCode == 409) continue;
        if (item.attempts + 1 >= maxAttempts) {
          continue;
        }
        remaining.add(item.copyWith(attempts: item.attempts + 1));
      } catch (_) {
        if (item.attempts + 1 >= maxAttempts) continue;
        remaining.add(item.copyWith(attempts: item.attempts + 1));
      }
    }

    await _persist(remaining);
    return ok;
  }

  Future<void> _dispatch(QueuedApiRequest item) async {
    switch (item.method) {
      case 'PUT':
        if (item.path.endsWith('/completion')) {
          final parts = item.path.split('/');
          await client.setMedicationCompletion(
            circleId: parts[3],
            itemId: parts[6],
            occurrenceKey: item.body!['occurrenceKey'] as String,
            completed: item.body!['completed'] as bool,
          );
          return;
        }
        if (item.path.contains('/reminders/appointment/') && item.path.endsWith('/status')) {
          final parts = item.path.split('/');
          await client.setAppointmentStatus(
            circleId: parts[3],
            itemId: parts[6],
            status: item.body!['status'] as String,
          );
          return;
        }
        if (item.path.contains('/reminders/task/') && item.path.endsWith('/status')) {
          final parts = item.path.split('/');
          await client.setTaskStatus(
            circleId: parts[3],
            itemId: parts[6],
            status: item.body!['status'] as String,
          );
          return;
        }
        if (item.path.contains('/reminders/')) {
          final segments = item.path.split('/');
          await client.upsertReminder(
            circleId: segments[3],
            module: segments[5],
            itemId: segments[6],
            payload: item.body ?? {},
          );
          return;
        }
        if (item.path.contains('/members/me/prefs')) {
          await client.updatePrefs(circleId: item.path.split('/')[3], prefs: item.body ?? {});
          return;
        }
        break;
      case 'POST':
        if (item.path.contains('/updates')) {
          await client.postUpdate(
            circleId: item.path.split('/')[3],
            updateType: item.body!['updateType'] as String,
            notes: item.body!['notes'] as String,
            idempotencyKey: item.headers['Idempotency-Key'],
          );
          return;
        }
        break;
      case 'DELETE':
        if (item.path.contains('/reminders/')) {
          final segments = item.path.split('/');
          await client.deleteReminder(
            circleId: segments[3],
            module: segments[5],
            itemId: segments[6],
          );
          return;
        }
        break;
    }
    throw StateError('Unsupported queued request: ${item.method} ${item.path}');
  }

  Future<void> _persist(List<QueuedApiRequest> items) => _store.saveAll(items);

  Future<List<QueuedApiRequest>> _load() => _store.loadAll();

  Future<int> pendingCount() async => (await _load()).length;
}

class JsonApiSyncQueueStore implements ApiSyncQueueStore {
  JsonApiSyncQueueStore({required this.readRaw, required this.writeRaw});

  final Future<String?> Function() readRaw;
  final Future<void> Function(String value) writeRaw;

  @override
  Future<List<QueuedApiRequest>> loadAll() async {
    final raw = await readRaw();
    if (raw == null || raw.isEmpty) return [];
    final list = jsonDecode(raw) as List<dynamic>;
    return list.map((e) => QueuedApiRequest.fromJson(e as Map<String, dynamic>)).toList();
  }

  @override
  Future<void> saveAll(List<QueuedApiRequest> items) async {
    await writeRaw(jsonEncode(items.map((e) => e.toJson()).toList()));
  }
}
