import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_broget/widgets/password_field.dart';

void main() {
  testWidgets('both editors survive visibility changes, blur and refocus', (
    tester,
  ) async {
    final controllers = [TextEditingController(), TextEditingController()];
    final nodes = [FocusNode(), FocusNode()];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Column(
            children: [
              for (var i = 0; i < 2; i++)
                PasswordField(
                  controller: controllers[i],
                  focusNode: nodes[i],
                  label: i == 0 ? 'Password' : 'Confirm password',
                  newPassword: true,
                  confirmation: i == 1,
                  validator: (_) => null,
                ),
            ],
          ),
        ),
      ),
    );
    for (var round = 0; round < 3; round++) {
      for (var i = 0; i < 2; i++) {
        final field = find.byType(TextFormField).at(i);
        await tester.enterText(field, 'Input123');
        controllers[i].selection = const TextSelection.collapsed(offset: 8);
        final editor = find.descendant(
          of: field,
          matching: find.byType(EditableText),
        );
        final oldEditor = tester.state(editor);
        await tester.tap(find.byType(IconButton).at(i));
        await tester.pumpAndSettle();
        if (kIsWeb) {
          expect(
            tester.state(find.byType(EditableText).at(i)),
            isNot(same(oldEditor)),
          );
        }
        nodes[1 - i].requestFocus();
        await tester.pump();
        nodes[i].requestFocus();
        await tester.pump();
        await tester.sendKeyEvent(LogicalKeyboardKey.backspace);
        await tester.pump();
        expect(controllers[i].text, 'Input12');
        tester.testTextInput.updateEditingValue(
          const TextEditingValue(
            text: 'Input12Z',
            selection: TextSelection.collapsed(offset: 8),
          ),
        );
        await tester.pump();
        expect(controllers[i].text, 'Input12Z');
      }
    }
    await tester.pumpWidget(const SizedBox.shrink());
    for (final controller in controllers) {
      controller.dispose();
    }
    for (final node in nodes) {
      node.dispose();
    }
  });
}
