import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:health_broget/core/theme/app_theme.dart';
import 'package:health_broget/data/models/models.dart';
import 'package:health_broget/data/repositories/repositories.dart';
import 'package:health_broget/features/authentication/auth_page.dart';
import 'package:health_broget/features/profile/profile_page.dart';
import 'package:health_broget/features/public/public_page.dart';
import 'package:health_broget/widgets/required_label.dart';

class _User extends Fake implements User {
  @override
  String get displayName => 'Sam';
  @override
  String get email => 'sam@example.com';
}

void main() {
  setUpAll(() async {
    await (FontLoader('HealthBrogetSans')
          ..addFont(rootBundle.load('assets/fonts/Roboto-Regular.ttf'))
          ..addFont(rootBundle.load('assets/fonts/Roboto-Bold.ttf')))
        .load();
    await (FontLoader(
      'MaterialIcons',
    )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
  });
  for (final width in [320.0, 768.0]) {
    testWidgets('registration consent and legal pages fit $width px', (
      tester,
    ) async {
      tester.view.physicalSize = Size(width, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final router = GoRouter(
        initialLocation: '/register',
        routes: [
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
            debugShowCheckedModeBanner: false,
            routerConfig: router,
          ),
        ),
      );
      await tester.runAsync(
        () => precacheImage(
          const AssetImage('assets/branding/health_broget_wordmark.png'),
          tester.element(find.byType(MaterialApp)),
        ),
      );
      await tester.pumpAndSettle();
      final checkbox = find.byKey(const ValueKey('accept-terms'));
      await tester.ensureVisible(checkbox);
      await tester.pumpAndSettle();
      expect(
        tester.getTopLeft(checkbox).dx,
        lessThan(tester.getTopLeft(find.text('I have read and agree to:')).dx),
      );
      expect(find.widgetWithText(TextButton, 'Privacy Policy'), findsOneWidget);
      expect(
        find.widgetWithText(TextButton, 'Terms of Service'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/register-${width.toInt()}.png'),
      );
      for (final path in ['/privacy', '/terms']) {
        router.push(path);
        await tester.pumpAndSettle();
        expect(find.byType(BackButton), findsOneWidget);
        expect(tester.takeException(), isNull);
        await expectLater(
          find.byType(MaterialApp),
          matchesGoldenFile(
            'goldens/${path.substring(1)}-${width.toInt()}.png',
          ),
        );
        router.pop();
        await tester.pumpAndSettle();
      }
    });
  }
  testWidgets(
    'required onboarding fields have red asterisks and optional fields do not',
    (tester) async {
      tester.view.physicalSize = const Size(320, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            sessionProvider.overrideWith((ref) => Stream.value(_User())),
            profileProvider.overrideWith(
              (ref) =>
                  Stream.value(const UserProfile(userId: 'test', name: 'Sam')),
            ),
          ],
          child: MaterialApp(
            theme: AppTheme.light,
            home: const ProfilePage(onboarding: true),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final labels = tester
          .widgetList<RequiredLabel>(find.byType(RequiredLabel))
          .map((label) => label.text)
          .toSet();
      expect(
        labels,
        containsAll([
          'Name',
          'Age (years)',
          'Height (cm)',
          'Weight (kg)',
          'Activity level',
          'Primary goal',
        ]),
      );
      expect(labels.any((label) => label.contains('optional')), false);
      final label = find.byWidgetPredicate(
        (w) => w is RequiredLabel && w.text == 'Name',
      );
      final text = tester.widget<Text>(
        find.descendant(of: label, matching: find.byType(Text)),
      );
      final star = (text.textSpan! as TextSpan).children!.single as TextSpan;
      expect(star.text, ' *');
      expect(star.style!.color, AppTheme.light.colorScheme.error);
      expect(tester.takeException(), isNull);
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/onboarding-required-320.png'),
      );
    },
  );
  testWidgets('registration consent wraps at 320 px with large text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          theme: AppTheme.light,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.6)),
            child: child!,
          ),
          home: const AuthPage(mode: 'register'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const ValueKey('accept-terms')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
