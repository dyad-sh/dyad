# Claude Code backend

## Model switching and the new-chat prompt

Decide whether to show "Start a new chat?" from the current chat's actual
message history and the selected model's backend. Do not infer message history
from the globally selected model or the chat's stored backend alone.

| Current chat's messages  | Model selected        | Show "Start a new chat?"? |
| ------------------------ | --------------------- | ------------------------- |
| No messages              | Any model             | No                        |
| Non–Claude Code messages | Claude Code model     | Yes                       |
| Non–Claude Code messages | Non–Claude Code model | No                        |
| Claude Code messages     | Claude Code model     | No                        |
| Claude Code messages     | Non–Claude Code model | Yes                       |

- An empty chat can switch models in place in either direction. Selecting a
  Claude Code model without sending a message does not require a new chat when
  switching away.
- Switching between Claude Code models does not require a new chat. Switching
  between non–Claude Code models does not require one either.
- Opening or navigating to a chat does not trigger this prompt. Evaluate the
  destination chat's own history when the user subsequently selects a model.
- When the prompt is required, cancelling preserves the current chat and model;
  confirming creates a new chat with the chosen model and preserves the old chat.
- The first-use Claude Code subscription disclosure is separate from the
  new-chat prompt and may still be required for an empty chat.
- Keep the picker and main-process mutation rules consistent. Regression tests
  should cover the table above, including a globally selected model or stored
  backend that does not reflect the current chat's actual message history.
