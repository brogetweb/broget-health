import 'package:flutter/material.dart';
import 'required_label.dart';

// The field's controller, focus and autofill identity stay stable when the
// containing form displays an error. Visibility is independent for each field.
class PasswordField extends StatefulWidget {
  const PasswordField({
    super.key,
    required this.controller,
    required this.focusNode,
    required this.label,
    required this.validator,
    this.newPassword = false,
    this.confirmation = false,
    this.onSubmitted,
    this.helperText,
  });
  final TextEditingController controller;
  final FocusNode focusNode;
  final String label;
  final FormFieldValidator<String> validator;
  final bool newPassword, confirmation;
  final ValueChanged<String>? onSubmitted;
  final String? helperText;
  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  bool hidden = true;
  void toggle() {
    final selection = widget.controller.selection;
    setState(() => hidden = !hidden);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      widget.focusNode.requestFocus();
      if (selection.isValid && selection.end <= widget.controller.text.length) {
        widget.controller.selection = selection;
      }
    });
  }

  @override
  Widget build(BuildContext context) => TextFormField(
    controller: widget.controller,
    focusNode: widget.focusNode,
    keyboardType: TextInputType.visiblePassword,
    autocorrect: false,
    enableSuggestions: false,
    obscureText: hidden,
    textInputAction: widget.newPassword && !widget.confirmation
        ? TextInputAction.next
        : TextInputAction.done,
    autofillHints: widget.newPassword
        ? const [AutofillHints.newPassword]
        : const [AutofillHints.password],
    decoration: InputDecoration(
      label: RequiredLabel(widget.label),
      helperText: widget.helperText,
      errorMaxLines: 3,
      suffixIcon: IconButton(
        onPressed: toggle,
        tooltip: widget.confirmation
            ? (hidden ? 'Show confirmation' : 'Hide confirmation')
            : (hidden ? 'Show password' : 'Hide password'),
        icon: Icon(
          hidden ? Icons.visibility_off_outlined : Icons.visibility_outlined,
        ),
      ),
    ),
    validator: widget.validator,
    onFieldSubmitted: widget.onSubmitted,
  );
}
