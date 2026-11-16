import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/ai/health_broget_service.dart';

class MealPhoto extends ConsumerStatefulWidget {
  const MealPhoto({super.key, required this.id});
  final String id;
  @override
  ConsumerState<MealPhoto> createState() => _MealPhotoState();
}

class _MealPhotoState extends ConsumerState<MealPhoto> {
  late Future<String> url;
  @override
  void initState() {
    super.initState();
    refresh();
  }

  void refresh() {
    url = ref.read(apiProvider).photoUrl(widget.id);
  }

  @override
  void didUpdateWidget(MealPhoto oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.id != widget.id) refresh();
  }

  Widget retry() => TextButton.icon(
    onPressed: () => setState(refresh),
    icon: const Icon(Icons.refresh),
    label: const Text('Reload meal photo'),
  );
  @override
  Widget build(BuildContext context) => SizedBox(
    height: 160,
    child: FutureBuilder<String>(
      future: url,
      builder: (context, snapshot) {
        if (snapshot.hasError) return retry();
        if (!snapshot.hasData) {
          return const Center(
            child: SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          );
        }
        return Image.network(
          snapshot.data!,
          webHtmlElementStrategy: WebHtmlElementStrategy.prefer,
          fit: BoxFit.contain,
          semanticLabel: 'Saved meal photograph',
          errorBuilder: (_, error, stack) => retry(),
        );
      },
    ),
  );
}
