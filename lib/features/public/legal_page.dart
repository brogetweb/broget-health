import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../widgets/brand_logo.dart';

class LegalPage extends StatelessWidget {
  const LegalPage({
    super.key,
    required this.privacy,
    required this.description,
    required this.paragraphs,
  });
  final bool privacy;
  final String description;
  final List<String> paragraphs;

  void back(BuildContext context) {
    if (context.canPop()) {
      context.pop();
    } else {
      context.go('/');
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final title = privacy ? 'Privacy Policy' : 'Terms of Service';
    final headings = privacy
        ? [
            'Information we use',
            'AI processing',
            'Photos and conversations',
            'Retention and deletion',
            'Service operator information',
          ]
        : [
            'What the service provides',
            'Estimates and limitations',
            'Your account and content',
            'Age requirements',
            'Availability and your rights',
            'Service operator information',
          ];
    return Scaffold(
      appBar: AppBar(
        leading: BackButton(onPressed: () => back(context)),
        title: Text(title),
      ),
      body: SelectionArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.symmetric(
            horizontal: MediaQuery.sizeOf(context).width < 600 ? 16 : 32,
            vertical: 24,
          ),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 760),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: BrandLogo(width: 160),
                  ),
                  const SizedBox(height: 24),
                  Text(title, style: theme.textTheme.headlineLarge),
                  const SizedBox(height: 8),
                  Text(description, style: theme.textTheme.bodyLarge),
                  const SizedBox(height: 12),
                  Text(
                    'Effective 28 October 2026',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 24),
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surface,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: theme.colorScheme.outlineVariant,
                      ),
                    ),
                    child: Padding(
                      padding: EdgeInsets.all(
                        MediaQuery.sizeOf(context).width < 600 ? 20 : 32,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          for (
                            var index = 0;
                            index < paragraphs.length;
                            index++
                          ) ...[
                            if (index > 0)
                              const Padding(
                                padding: EdgeInsets.symmetric(vertical: 24),
                                child: Divider(height: 1),
                              ),
                            Text(
                              headings[index],
                              style: theme.textTheme.titleMedium?.copyWith(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 10),
                            Text(
                              paragraphs[index],
                              style: theme.textTheme.bodyMedium?.copyWith(
                                height: 1.7,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),
                  Wrap(
                    alignment: WrapAlignment.spaceBetween,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 16,
                    runSpacing: 12,
                    children: [
                      OutlinedButton.icon(
                        onPressed: () => back(context),
                        icon: const Icon(Icons.arrow_back),
                        label: const Text('Back'),
                      ),
                      TextButton(
                        onPressed: () =>
                            context.replace(privacy ? '/terms' : '/privacy'),
                        child: Text(
                          privacy
                              ? 'Read Terms of Service'
                              : 'Read Privacy Policy',
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
