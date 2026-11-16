import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:health_broget/services/ai/health_broget_service.dart';
import 'package:health_broget/services/api_watch.dart';
import 'package:health_broget/data/repositories/repositories.dart';
import 'package:health_broget/core/errors/app_error.dart';

class TestApi extends HealthBrogetApi {
  TestApi() : super(http.Client());
  String? uid = 'owner';
  @override
  String? get currentUserId => uid;
  final paths = <String>[];
  Future<Map<String, dynamic>> Function()? response;
  @override
  Future<Map<String, dynamic>> request(
    String method,
    String path, [
    Map<String, dynamic>? body,
  ]) async {
    paths.add(path);
    return response == null
        ? {'meals': [], 'cursor': 'opaque-server-cursor', 'hasMore': true}
        : response!();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('meal paging uses the server cursor and date-range API', () async {
    final api = TestApi();
    addTearDown(api.dispose);
    final meals = MealRepository(api);
    final first = await meals.page('owner');
    expect(first.cursor, 'opaque-server-cursor');
    await meals.page('owner', cursor: first.cursor);
    expect(api.paths.last, '/meals?cursor=opaque-server-cursor');
    await meals.report(
      'owner',
      DateTime.utc(2026, 1, 1),
      DateTime.utc(2026, 1, 2),
    );
    final query = Uri.parse(api.paths.last).queryParameters;
    expect(query['start'], '2026-01-01T00:00:00.000Z');
    expect(query['end'], '2026-01-02T00:00:00.000Z');
  });
  test(
    'account changes discard an in-flight response for the previous owner',
    () async {
      final api = TestApi();
      addTearDown(api.dispose);
      final pending = Completer<Map<String, dynamic>>();
      api.response = () => pending.future;
      final request = MealRepository(api).page('owner');
      final rejected = expectLater(
        request,
        throwsA(
          isA<AppError>().having((e) => e.code, 'code', 'sign-in-required'),
        ),
      );
      api.uid = 'different-owner';
      pending.complete({'meals': [], 'cursor': null, 'hasMore': false});
      await rejected;
    },
  );
  test(
    'REST subscriptions refresh on mutation and discard data after cancellation',
    () async {
      final api = TestApi();
      addTearDown(api.dispose);
      var loads = 0;
      final values = <int>[];
      Completer<int>? pending;
      final subscription = watchApi<int>(api, () async {
        loads++;
        if (pending != null) return await pending.future;
        return loads;
      }).listen(values.add);
      await Future<void>.delayed(Duration.zero);
      expect(values, [1]);
      api.refreshData();
      await Future<void>.delayed(Duration.zero);
      expect(values, [1, 2]);
      pending = Completer<int>();
      api.refreshData();
      await Future<void>.delayed(Duration.zero);
      await subscription.cancel();
      pending.complete(99);
      await Future<void>.delayed(Duration.zero);
      expect(values, [1, 2]);
      api.refreshData();
      await Future<void>.delayed(Duration.zero);
      expect(loads, 3);
    },
  );
}
