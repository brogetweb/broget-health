import 'package:flutter/material.dart';

class RequiredLabel extends StatelessWidget {
  const RequiredLabel(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Text.rich(
    TextSpan(
      text: text,
      children: [
        TextSpan(
          text: ' *',
          style: TextStyle(
            color: Theme.of(context).colorScheme.error,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
    semanticsLabel: '$text, required',
  );
}
