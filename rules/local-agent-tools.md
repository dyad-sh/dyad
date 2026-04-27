# Local Agent Tool Definitions

Agent tool definitions live in `src/pro/main/ipc/handlers/local_agent/tools/`. Each tool has a `ToolDefinition` with optional flags.

## Read-only / plan-only mode

- **`modifiesState: true`** must be set on any tool that writes to disk or modifies external state (files, database, etc.). This flag controls whether the tool is available in read-only (ask) mode and plan-only mode — see `buildAgentToolSet` in `tool_definitions.ts`.
- Similarly, code in the `handleLocalAgentStream` handler that writes to the workspace (e.g., `ensureDyadGitignored`, injecting synthetic todo reminders) should be guarded with `if (!readOnly && !planModeOnly)` checks. Injecting instructions that reference state-changing tools into non-writable runs will confuse the model since those tools are filtered out.

## Async I/O

- Use `fs.promises` (not sync `fs` methods) in any code running on the Electron main process (e.g., `todo_persistence.ts`) to avoid blocking the event loop.

## User-visible tool output

- For Local Agent post-tool side effects that happen after the model/tool loop (for example shared Supabase function redeploys), use `ctx.onXmlComplete(...)` with escaped `<dyad-output>` content to surface warnings/errors inline. `warningMessages` creates toast warnings, and throwing turns the whole stream into a `ChatErrorBox`.
- **`ctx.onXmlComplete` only updates the message `content` column and the UI; it does NOT make output visible to future agent turns.** `parseAiMessagesJson` reads from `aiMessagesJson` whenever it's present and ignores `content` entirely. For post-loop output that the agent should see next turn (deploy results, step-limit notices), also push a trailing assistant message into `accumulatedAiMessages` BEFORE the `aiMessagesJson` write, e.g.: `accumulatedAiMessages.push({ role: "assistant", content: [{ type: "text", text: xml }] })`.

## Stream retries

- When extending `handleLocalAgentStream` retry behavior, do not only match transport errors like `"terminated"`. Providers can emit structured stream errors such as `{ type: "error", error: { type: "server_error", ... } }`, and those transient 5xx / rate-limit failures need explicit retry classification too.

## Metadata-only stop tools

- If a metadata-only tool such as `set_chat_summary` is added to `stopWhen`, audit downstream pass gates that inspect the final step's `toolCalls`. A final metadata tool call should not suppress safety follow-up passes such as incomplete todo reminders.

## Prompt and request snapshots

- When changing local-agent prompt text or tool descriptions, update both prompt unit snapshots and E2E request snapshots; stale request snapshots can still contain old tool descriptions even after unit prompt snapshots pass.
