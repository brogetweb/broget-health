import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:health_broget/core/config/password_policy.dart';
import 'package:health_broget/core/theme/app_theme.dart';
import 'package:health_broget/data/repositories/repositories.dart';
import 'package:health_broget/features/authentication/auth_page.dart';
import 'package:health_broget/features/public/public_page.dart';

class _Auth extends Fake implements FirebaseAuth {}

class _Repository extends AuthRepository {
  _Repository() : super(_Auth());
  int calls = 0;
  bool fail = true;
  String? lastPassword;
  @override
  Future<bool> register(String name, String email, String password) async {
    calls++;
    lastPassword = password;
    await Future<void>.delayed(Duration.zero);
    if (fail) throw FirebaseAuthException(code: 'email-already-in-use');
    return true;
  }

  @override
  Future<void> login(String email, String password) async {
    calls++;
    lastPassword = password;
    await Future<void>.delayed(Duration.zero);
    throw FirebaseAuthException(code: 'invalid-credential');
  }
}

Finder field(String key) => find.descendant(
  of: find.byKey(ValueKey(key)),
  matching: find.byType(TextField),
);
Future<void> type(WidgetTester tester, String key, String text) async {
  final target = field(key);
  await tester.ensureVisible(target);
  await tester.enterText(target, text);
}

Future<void> submit(WidgetTester tester, String label) async {
  final button = find.widgetWithText(FilledButton, label);
  await tester.ensureVisible(button);
  await tester.pumpAndSettle();
  await tester.tap(button);
  await tester.pumpAndSettle();
}

Future<void> accept(WidgetTester tester) async {
  tester.testTextInput.hide();
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pumpAndSettle();
  final checkbox = find.byKey(const ValueKey('accept-terms'));
  await tester.ensureVisible(checkbox);
  await tester.pumpAndSettle();
  await tester.tap(checkbox);
  await tester.pumpAndSettle();
}

void main() {
  test('password policy accepts exactly six characters and rejects five', () {
    expect(validatePassword('123456'), isNull);
    expect(validatePassword('12345'), 'Use at least 6 characters');
  });
  for (final mode in ['register', 'login']) {
    testWidgets(
      '$mode password remains editable after repeated server errors',
      (tester) async {
        final auth = _Repository();
        await tester.pumpWidget(
          ProviderScope(
            overrides: [authRepositoryProvider.overrideWithValue(auth)],
            child: MaterialApp(
              theme: AppTheme.light,
              home: AuthPage(mode: mode),
            ),
          ),
        );
        if (mode == 'register') await type(tester, 'auth-name', 'Sam');
        await type(tester, 'auth-email', 'sam@example.com');
        await type(tester, 'auth-password', 'abc123');
        if (mode == 'register') {
          await type(tester, 'auth-confirmation', 'abc123');
          await accept(tester);
        }
        final controller = tester
            .widget<TextField>(field('auth-password'))
            .controller;
        for (var attempt = 1; attempt <= 2; attempt++) {
          await submit(
            tester,
            mode == 'register' ? 'Create account' : 'Sign in',
          );
          expect(auth.calls, attempt);
          final password = tester.widget<TextField>(field('auth-password'));
          expect(password.controller, same(controller));
          expect(password.readOnly, false);
          expect(password.focusNode!.hasFocus, true);
          await tester.ensureVisible(field('auth-password'));
          await tester.pumpAndSettle();
          await tester.tap(find.byTooltip('Show password'));
          await tester.pumpAndSettle();
          controller!.selection = TextSelection.collapsed(
            offset: controller.text.length,
          );
          await tester.sendKeyEvent(LogicalKeyboardKey.backspace);
          await tester.pump();
          expect(controller.text, 'abc12');
          await type(tester, 'auth-password', 'abc123');
          if (mode == 'register') {
            await type(tester, 'auth-confirmation', 'abc124');
            expect(
              tester
                  .widget<TextField>(field('auth-confirmation'))
                  .controller!
                  .text,
              'abc124',
            );
            await type(tester, 'auth-confirmation', 'abc123');
          }
          await tester.ensureVisible(find.byTooltip('Hide password'));
          await tester.pumpAndSettle();
          await tester.tap(find.byTooltip('Hide password'));
          await tester.pumpAndSettle();
        }
        expect(tester.takeException(), isNull);
      },
    );
  }
  testWidgets(
    'registration validation permits six characters and requires explicit consent',
    (tester) async {
      final auth = _Repository()..fail = false;
      await tester.pumpWidget(
        ProviderScope(
          overrides: [authRepositoryProvider.overrideWithValue(auth)],
          child: MaterialApp(
            theme: AppTheme.light,
            home: const AuthPage(mode: 'register'),
          ),
        ),
      );
      await type(tester, 'auth-name', 'Sam');
      await type(tester, 'auth-email', 'sam@example.com');
      await type(tester, 'auth-password', '12345');
      await type(tester, 'auth-confirmation', '12345');
      await submit(tester, 'Create account');
      expect(auth.calls, 0);
      expect(find.text('Use at least 6 characters'), findsOneWidget);
      await type(tester, 'auth-password', '123456');
      await type(tester, 'auth-confirmation', '123456');
      await submit(tester, 'Create account');
      expect(auth.calls, 0);
      expect(
        find.text('Please agree to the Privacy Policy and Terms of Service.'),
        findsOneWidget,
      );
      await accept(tester);
      await submit(tester, 'Create account');
      expect(auth.calls, 1);
      expect(auth.lastPassword, '123456');
    },
  );
  testWidgets(
    'reading a policy and returning preserves registration fields and consent',
    (tester) async {
      final router = GoRouter(
        initialLocation: '/register',
        routes: [
          GoRoute(path: '/', builder: (_, _) => const SizedBox()),
          GoRoute(
            path: '/register',
            builder: (_, _) => const AuthPage(mode: 'register'),
          ),
          GoRoute(
            path: '/privacy',
            builder: (_, _) => const PublicPage(path: '/privacy'),
          ),
          GoRoute(
            path: '/terms',
            builder: (_, _) => const PublicPage(path: '/terms'),
          ),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp.router(
            theme: AppTheme.light,
            routerConfig: router,
          ),
        ),
      );
      await type(tester, 'auth-name', 'Saved name');
      await type(tester, 'auth-password', '123456');
      await accept(tester);
      final policy = find.widgetWithText(TextButton, 'Privacy Policy');
      await tester.ensureVisible(policy);
      await tester.pumpAndSettle();
      await tester.tap(policy);
      await tester.pumpAndSettle();
      expect(find.text('Information we use'), findsOneWidget);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(field('auth-name')).controller!.text,
        'Saved name',
      );
      expect(
        tester.widget<TextField>(field('auth-password')).controller!.text,
        '123456',
      );
      expect(
        tester
            .widget<Checkbox>(find.byKey(const ValueKey('accept-terms')))
            .value,
        true,
      );
    },
  );
}
