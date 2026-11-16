import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../data/repositories/repositories.dart';
import '../../core/errors/app_error.dart';
import '../../core/config/app_config.dart';
import '../../widgets/common.dart';
import '../../widgets/brand_logo.dart';
import '../../widgets/required_label.dart';
import '../../widgets/password_field.dart';
import '../../core/config/password_policy.dart';
import 'terms_consent.dart';

class AuthPage extends ConsumerStatefulWidget {
  const AuthPage({super.key, required this.mode});
  final String mode;
  @override
  ConsumerState<AuthPage> createState() => _AuthPageState();
}

class _AuthPageState extends ConsumerState<AuthPage> {
  final form = GlobalKey<FormState>();
  final name = TextEditingController(),
      email = TextEditingController(),
      password = TextEditingController(),
      confirmation = TextEditingController();
  bool busy = false, resetSent = false;
  final passwordFocus = FocusNode();
  final confirmationFocus = FocusNode();
  String? error;
  @override
  void dispose() {
    name.dispose();
    email.dispose();
    password.dispose();
    confirmation.dispose();
    passwordFocus.dispose();
    confirmationFocus.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (busy) return;
    // Close the old native editing connection before validation or an async
    // auth attempt; refocus after failure opens a fresh editable connection.
    FocusScope.of(context).unfocus();
    if (!form.currentState!.validate()) return;
    final enteredName = name.text,
        enteredEmail = email.text,
        enteredPassword = password.text;
    setState(() {
      busy = true;
      error = null;
    });
    bool failed = false;
    try {
      final auth = ref.read(authRepositoryProvider);
      if (widget.mode == 'register') {
        final sent = await auth.register(
          enteredName,
          enteredEmail,
          enteredPassword,
        );
        if (!sent && mounted) {
          notify(
            context,
            'Account created. Request another verification email from Overview.',
          );
        }
      } else if (widget.mode == 'forgot-password') {
        await auth.reset(enteredEmail);
        if (mounted) setState(() => resetSent = true);
      } else {
        await auth.login(enteredEmail, enteredPassword);
      }
      if (widget.mode != 'forgot-password') {
        TextInput.finishAutofillContext(shouldSave: true);
      }
    } catch (e) {
      failed = true;
      TextInput.finishAutofillContext(shouldSave: false);
      if (mounted) setState(() => error = friendlyError(e));
    } finally {
      if (mounted) {
        setState(() => busy = false);
        if (failed && widget.mode != 'forgot-password') {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted && !busy) passwordFocus.requestFocus();
          });
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final register = widget.mode == 'register',
        reset = widget.mode == 'forgot-password';
    final title = register
        ? 'Make room for a healthier you.'
        : reset
        ? 'Let’s get you back in.'
        : 'Good to see you again.';
    return Scaffold(
      appBar: AppBar(
        title: TextButton(
          onPressed: () => context.go('/'),
          child: const BrandLogo(width: 150),
        ),
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(
            MediaQuery.sizeOf(context).width < 600 ? 16 : 24,
          ),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: Panel(
              padding: MediaQuery.sizeOf(context).width < 600 ? 20 : 28,
              child: Form(
                key: form,
                child: AutofillGroup(
                  onDisposeAction: AutofillContextAction.cancel,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Center(child: BrandLogo(width: 230)),
                      const SizedBox(height: 24),
                      Text(
                        title,
                        style: Theme.of(context).textTheme.headlineMedium,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        reset
                            ? 'We’ll send a reset link if an account exists.'
                            : 'Your food, your progress, your own pace.',
                      ),
                      const SizedBox(height: 24),
                      if (!AppConfig.production)
                        const Padding(
                          padding: EdgeInsets.only(bottom: 16),
                          child: Text(
                            'Development environment · use test accounts only.',
                          ),
                        ),
                      if (register) ...[
                        TextFormField(
                          key: const ValueKey('auth-name'),
                          controller: name,
                          decoration: const InputDecoration(
                            label: RequiredLabel('Your name'),
                          ),
                          maxLength: 80,
                          autofillHints: const [AutofillHints.name],
                          validator: requiredText,
                        ),
                        const SizedBox(height: 12),
                      ],
                      TextFormField(
                        key: const ValueKey('auth-email'),
                        controller: email,
                        decoration: const InputDecoration(
                          label: RequiredLabel('Email address'),
                        ),
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.email],
                        validator: validEmail,
                      ),
                      const SizedBox(height: 16),
                      if (!reset) ...[
                        PasswordField(
                          key: const ValueKey('auth-password'),
                          controller: password,
                          focusNode: passwordFocus,
                          label: 'Password',
                          newPassword: register,
                          helperText: register
                              ? 'At least $minimumPasswordLength characters'
                              : null,
                          validator: validatePassword,
                          onSubmitted: (_) {
                            if (register) {
                              confirmationFocus.requestFocus();
                            } else if (!busy) {
                              submit();
                            }
                          },
                        ),
                        const SizedBox(height: 16),
                      ],
                      if (register) ...[
                        PasswordField(
                          key: const ValueKey('auth-confirmation'),
                          controller: confirmation,
                          focusNode: confirmationFocus,
                          label: 'Confirm password',
                          newPassword: true,
                          confirmation: true,
                          validator: (v) => v == null || v.isEmpty
                              ? 'Confirm your password'
                              : v != password.text
                              ? 'Passwords must match'
                              : null,
                          onSubmitted: (_) {
                            if (!busy) submit();
                          },
                        ),
                        const SizedBox(height: 20),
                        const TermsConsent(),
                        const SizedBox(height: 20),
                      ],
                      if (error != null)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          child: Semantics(
                            liveRegion: true,
                            child: Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: Theme.of(
                                  context,
                                ).colorScheme.errorContainer,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text(
                                error!,
                                style: TextStyle(
                                  color: Theme.of(
                                    context,
                                  ).colorScheme.onErrorContainer,
                                ),
                              ),
                            ),
                          ),
                        ),
                      if (resetSent)
                        const Padding(
                          padding: EdgeInsets.only(bottom: 16),
                          child: Text(
                            'Check your inbox. If an account exists, a password reset link has been sent.',
                          ),
                        ),
                      FilledButton(
                        onPressed: busy ? null : submit,
                        child: busy
                            ? const SizedBox(
                                height: 22,
                                width: 22,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : Text(
                                register
                                    ? 'Create account'
                                    : reset
                                    ? 'Send reset link'
                                    : 'Sign in',
                              ),
                      ),
                      if (!reset && !register)
                        TextButton(
                          onPressed: () => context.go('/forgot-password'),
                          child: const Text('Forgot password?'),
                        ),
                      TextButton(
                        onPressed: () => context.go(
                          register || reset ? '/login' : '/register',
                        ),
                        child: Text(
                          register || reset
                              ? 'Back to sign in'
                              : 'New here? Create an account',
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
