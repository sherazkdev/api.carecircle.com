import 'package:care_circle_backend_client/care_circle_backend_client.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('queueUpsertReminder dedupes by circle/module/item', () async {
    final store = InMemoryApiSyncQueueStore();
    final client = _NoopClient();
    final sync = CareCircleSyncFacade(client: client, store: store);

    await sync.queueUpsertReminder(
      circleId: 'c1',
      module: 'medication',
      itemId: 'm1',
      payload: {'title': 'A', 'v': 1},
    );
    await sync.queueUpsertReminder(
      circleId: 'c1',
      module: 'medication',
      itemId: 'm1',
      payload: {'title': 'A', 'v': 2},
    );

    final pending = await store.loadAll();
    expect(pending.length, 1);
    expect(pending.first.body?['v'], 2);
  });

  test('flushQueue processes reminder upsert', () async {
    final store = InMemoryApiSyncQueueStore();
    final client = _RecordingClient();
    final sync = CareCircleSyncFacade(client: client, store: store);

    await sync.queueUpsertReminder(
      circleId: 'c1',
      module: 'medication',
      itemId: 'm1',
      payload: {'title': 'Med'},
    );
    final n = await sync.flushQueue();
    expect(n, 1);
    expect(client.upsertCalls, 1);
    expect(await sync.pendingCount(), 0);
  });
}

class _NoopClient extends CareCircleBackendClient {
  _NoopClient() : super(baseUrl: 'https://example.com', auth: _FakeAuth());
}

class _RecordingClient extends CareCircleBackendClient {
  _RecordingClient() : super(baseUrl: 'https://example.com', auth: _FakeAuth());

  var upsertCalls = 0;

  @override
  Future<Map<String, dynamic>> upsertReminder({
    required String circleId,
    required String module,
    required String itemId,
    required Map<String, dynamic> payload,
  }) async {
    upsertCalls += 1;
    return {};
  }
}

class _FakeAuth implements FirebaseAuth {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
