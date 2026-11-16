import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class TermsConsent extends StatelessWidget {
  const TermsConsent({super.key});
  @override
  Widget build(BuildContext context) => FormField<bool>(
    initialValue: false,
    validator: (value) => value == true
        ? null
        : 'Please agree to the Privacy Policy and Terms of Service.',
    builder: (field) {
      final theme = Theme.of(context);
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              color: theme.colorScheme.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: field.hasError
                    ? theme.colorScheme.error
                    : theme.colorScheme.outlineVariant,
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(4, 8, 12, 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Checkbox(
                    key: const ValueKey('accept-terms'),
                    value: field.value ?? false,
                    onChanged: (value) => field.didChange(value ?? false),
                    semanticLabel:
                        'I agree to the Privacy Policy and Terms of Service',
                    isError: field.hasError,
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text(
                            'I have read and agree to:',
                            style: theme.textTheme.bodySmall,
                          ),
                        ),
                        Wrap(
                          spacing: 12,
                          children: [
                            _PolicyLink('Privacy Policy', '/privacy'),
                            _PolicyLink('Terms of Service', '/terms'),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (field.hasError)
            Padding(
              padding: const EdgeInsets.only(top: 8, left: 12),
              child: Semantics(
                liveRegion: true,
                child: Text(
                  field.errorText!,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.error,
                  ),
                ),
              ),
            ),
        ],
      );
    },
  );
}

class _PolicyLink extends StatelessWidget {
  const _PolicyLink(this.text, this.path);
  final String text, path;
  @override
  Widget build(BuildContext context) => TextButton(
    style: TextButton.styleFrom(
      padding: EdgeInsets.zero,
      minimumSize: const Size(0, 40),
      alignment: Alignment.centerLeft,
      textStyle: Theme.of(context).textTheme.labelLarge?.copyWith(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        decoration: TextDecoration.underline,
      ),
    ),
    onPressed: () => context.push(path),
    child: Text(text),
  );
}
