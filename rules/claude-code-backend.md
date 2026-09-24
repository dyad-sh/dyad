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
- Enabling Claude Code subscription usage does not require a separate first-use
  consent dialog. Keep the new-chat confirmation for existing conversations.
- Keep the picker and main-process mutation rules consistent. Regression tests
  should cover the table above, including a globally selected model or stored
  backend that does not reflect the current chat's actual message history.

## Diagnosing CLI failures

- On macOS, sandboxed `claude auth status` can report `loggedIn: false` when the same account is signed in outside the sandbox. Verify outside the sandbox before diagnosing an authentication failure.
- For a failed turn, `userData/claude-sessions/<chatId>.json` identifies the CLI session; its `~/.claude/projects/<app-path>/<sessionId>.jsonl` record can contain a synthetic assistant entry with the actual API error. Inspect only its error fields, since the file also contains private conversation content.
- When projecting CLI errors through the Git output redactor, assert the exact displayed OAuth refresh guidance and `/login` command: `token:` prose can be mistaken for a secret, and a slash command for an absolute path. Keep credential and real-path redaction tests alongside those assertions.
