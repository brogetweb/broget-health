const minimumPasswordLength = 6;

String? validatePassword(String? value) {
  if (value == null || value.isEmpty) return 'Enter your password';
  if (value.length < minimumPasswordLength) {
    return 'Use at least $minimumPasswordLength characters';
  }
  return null;
}
