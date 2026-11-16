import 'dart:async';
import 'package:flutter/widgets.dart';
import 'ai/health_broget_service.dart';

// REST-backed streams refresh after mutations and when returning to the app.
// A single request is in flight per subscription; cancellation discards late data.
Stream<T> watchApi<T>(HealthBrogetApi api, Future<T> Function() load) {
  late StreamController<T> controller;
  Timer? timer;
  StreamSubscription<void>? changes;
  late _ResumeObserver observer;
  bool stopped = false, busy = false, queued = false;
  Future<void> refresh() async {
    if (stopped) return;
    if (busy) {
      queued = true;
      return;
    }
    busy = true;
    do {
      queued = false;
      try {
        final value = await load();
        if (!stopped) controller.add(value);
      } catch (error, stack) {
        if (!stopped) controller.addError(error, stack);
      }
    } while (queued && !stopped);
    busy = false;
  }

  controller = StreamController<T>(
    onListen: () {
      observer = _ResumeObserver(refresh);
      WidgetsBinding.instance.addObserver(observer);
      changes = api.changes.listen((_) => refresh());
      timer = Timer.periodic(const Duration(seconds: 60), (_) {
        if (WidgetsBinding.instance.lifecycleState ==
                AppLifecycleState.resumed ||
            WidgetsBinding.instance.lifecycleState == null) {
          refresh();
        }
      });
      refresh();
    },
    onCancel: () async {
      stopped = true;
      timer?.cancel();
      await changes?.cancel();
      WidgetsBinding.instance.removeObserver(observer);
    },
  );
  return controller.stream;
}

class _ResumeObserver extends WidgetsBindingObserver {
  _ResumeObserver(this.refresh);
  final Future<void> Function() refresh;
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) refresh();
  }
}
