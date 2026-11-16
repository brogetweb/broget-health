import '../../services/api_watch.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/models.dart';
import '../../services/ai/health_broget_service.dart';

final authRepositoryProvider = Provider(
  (ref) => AuthRepository(FirebaseAuth.instance),
);
final sessionProvider = StreamProvider<User?>(
  (ref) => ref.watch(authRepositoryProvider).changes,
);
final userRepositoryProvider = Provider(
  (ref) => UserRepository(ref.watch(apiProvider)),
);
final profileProvider = StreamProvider<UserProfile?>((ref) {
  final user = ref.watch(sessionProvider).value;
  return user == null
      ? Stream.value(null)
      : ref.watch(userRepositoryProvider).watch(user.uid);
});
final mealRepositoryProvider = Provider(
  (ref) => MealRepository(ref.watch(apiProvider)),
);
final selectedDayProvider = NotifierProvider<SelectedDay, DateTime>(
  SelectedDay.new,
);

class SelectedDay extends Notifier<DateTime> {
  @override
  DateTime build() => dayStart(DateTime.now());
  void select(DateTime day) => state = dayStart(day);
}

final dailyMealsProvider = StreamProvider<List<Meal>>((ref) {
  final user = ref.watch(sessionProvider).value;
  if (user == null) return Stream.value([]);
  final day = ref.watch(selectedDayProvider);
  return ref
      .watch(mealRepositoryProvider)
      .watchRange(user.uid, day, DateTime(day.year, day.month, day.day + 1));
});
final settingsProvider = StreamProvider<AppSettings>((ref) {
  final uid = ref.watch(sessionProvider).value?.uid;
  return uid == null
      ? Stream.value(const AppSettings())
      : ref.watch(userRepositoryProvider).settings(uid);
});
final chatRepositoryProvider = Provider(
  (ref) => ChatRepository(ref.watch(apiProvider)),
);
final chatProvider = StreamProvider<List<ChatMessage>>((ref) {
  final uid = ref.watch(sessionProvider).value?.uid;
  return uid == null
      ? Stream.value([])
      : ref.watch(chatRepositoryProvider).watch(uid);
});

class AuthRepository {
  AuthRepository(this.auth);
  final FirebaseAuth auth;
  Stream<User?> get changes => auth.userChanges();
  Future<void> login(String email, String password) async {
    await auth.signInWithEmailAndPassword(
      email: email.trim(),
      password: password,
    );
  }

  Future<bool> register(String name, String email, String password) async {
    final credential = await auth.createUserWithEmailAndPassword(
      email: email.trim(),
      password: password,
    );
    try {
      await credential.user!.updateDisplayName(name.trim());
      await credential.user!.sendEmailVerification();
      return true;
    } on FirebaseAuthException {
      // The account already exists: allow onboarding and resend from Overview.
      return false;
    }
  }

  Future<void> reset(String email) async {
    try {
      await auth.sendPasswordResetEmail(email: email.trim());
    } on FirebaseAuthException catch (error) {
      if (error.code != 'user-not-found') rethrow;
      // Keep the same response for registered and unregistered addresses.
    }
  }

  Future<bool> refreshVerification() async {
    await auth.currentUser?.reload();
    final user = auth.currentUser;
    if (user == null) return false;
    await user.getIdToken(true);
    return user.emailVerified;
  }

  Future<void> signOut() => auth.signOut();
  Future<void> reauthenticate(String password) async {
    final user = auth.currentUser!;
    await user.reauthenticateWithCredential(
      EmailAuthProvider.credential(email: user.email!, password: password),
    );
  }
}

class UserRepository {
  UserRepository(this.api);
  final HealthBrogetApi api;
  Stream<UserProfile?> watch(String uid) => watchApi(
    api,
    () => api.forUser(uid, () async {
      final data = await api.request('GET', '/profile');
      return UserProfile.fromJson(
        uid,
        Map<String, dynamic>.from(data['profile']),
      );
    }),
  );
  Future<void> ensureAccount(User user) async {
    await api.forUser(
      user.uid,
      () => api.request('POST', '/account/bootstrap', {
        'name': user.displayName ?? '',
      }),
    );
  }

  Future<void> save(String uid, String name, HealthProfile health) async {
    if (!health.valid || name.trim().isEmpty || name.length > 80) {
      throw const FormatException('Invalid profile');
    }
    await api.forUser(
      uid,
      () => api.request('PUT', '/profile', {
        'name': name.trim(),
        'health': health.toJson(),
      }),
    );
  }

  Stream<AppSettings> settings(String uid) => watchApi(
    api,
    () => api.forUser(
      uid,
      () async => AppSettings.fromJson(await api.request('GET', '/settings')),
    ),
  );
  Future<void> saveSettings(String uid, AppSettings settings) async {
    await api.forUser(
      uid,
      () => api.request('PUT', '/settings', settings.toJson()),
    );
  }
}

class MealRepository {
  MealRepository(this.api);
  final HealthBrogetApi api;
  Future<List<Meal>> report(String uid, DateTime start, DateTime end) =>
      api.forUser(uid, () async {
        final query = Uri(
          queryParameters: {
            'start': start.toUtc().toIso8601String(),
            'end': end.toUtc().toIso8601String(),
          },
        ).query;
        final data = await api.request('GET', '/meals?$query');
        return (data['meals'] as List)
            .map((m) => Meal.fromJson(m['id'], Map<String, dynamic>.from(m)))
            .toList();
      });
  Stream<List<Meal>> watchRange(String uid, DateTime start, DateTime end) =>
      watchApi(api, () => report(uid, start, end));
  Future<MealPage> page(String uid, {String? cursor}) =>
      api.forUser(uid, () async {
        final data = await api.request(
          'GET',
          cursor == null
              ? '/meals'
              : '/meals?cursor=${Uri.encodeQueryComponent(cursor)}',
        );
        return MealPage(
          (data['meals'] as List)
              .map((m) => Meal.fromJson(m['id'], Map<String, dynamic>.from(m)))
              .toList(),
          data['cursor'] as String?,
          data['hasMore'] == true,
        );
      });
  Future<void> save(Meal meal) async {
    if (!mealTypes.contains(meal.mealType) ||
        meal.foods.isEmpty ||
        meal.foods.length > 12 ||
        meal.foods.any(
          (f) => !f.grams.isFinite || f.grams < 1 || f.grams > 3000,
        )) {
      throw const FormatException('Invalid meal');
    }
    await api.forUser(
      meal.userId,
      () async => api.request('PUT', '/meals/${meal.id}', {
        'id': meal.id,
        'mealType': meal.mealType,
        'eatenAt': meal.eatenAt.toUtc().toIso8601String(),
        'foods': meal.foods.map((f) => f.toJson()).toList(),
        'imagePath': meal.imagePath,
        'timeZone': await api.timeZone,
      }),
    );
  }

  Future<void> delete(String uid, String id) async {
    await api.forUser(uid, () => api.request('DELETE', '/meals/$id'));
  }
}

class MealPage {
  MealPage(this.meals, this.cursor, this.hasMore);
  final List<Meal> meals;
  final String? cursor;
  final bool hasMore;
}

class ChatRepository {
  ChatRepository(this.api);
  final HealthBrogetApi api;
  Stream<List<ChatMessage>> watch(String uid) => watchApi(
    api,
    () => api.forUser(uid, () async {
      final data = await api.request('GET', '/chat');
      return (data['messages'] as List)
          .map(
            (m) => ChatMessage(
              m['id'],
              m['role'],
              m['text'],
              m['createdAt'] == null ? null : dateValue(m['createdAt']),
            ),
          )
          .toList();
    }),
  );
}
