import 'package:care_circle_backend_client/care_circle_backend_client.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('QueuedApiRequest round-trip JSON', () {
    final item = QueuedApiRequest(
      id: '1',
      method: 'PUT',
      path: '/v1/circles/c1/reminders/medication/m1',
      body: {'title': 'Test'},
      createdAt: DateTime.utc(2026, 1, 1),
    );
    final decoded = QueuedApiRequest.fromJson(item.toJson());
    expect(decoded.id, '1');
    expect(decoded.path, item.path);
  });

  test('InMemoryApiSyncQueueStore persists items', () async {
    final store = InMemoryApiSyncQueueStore();
    await store.saveAll([
      QueuedApiRequest(
        id: 'a',
        method: 'PUT',
        path: '/x',
        createdAt: DateTime.now().toUtc(),
      ),
    ]);
    expect((await store.loadAll()).length, 1);
  });
}
