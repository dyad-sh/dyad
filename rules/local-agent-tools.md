# Local Agent Tool Definitions

Agent tool definitions live in `src/pro/main/ipc/handlers/local_agent/tools/`. Each tool has a `ToolDefinition` with optional flags.

## Read-only / plan-only mode

- **`modifiesState: true`** must be set on any tool that writes to disk or modifies external state (files, database, etc.). This flag controls whether the tool is available in read-only (ask) mode and plan-only mode — see `buildAgentToolSet` in `tool_definitions.ts`.
- Similarly, code in the `handleLocalAgentStream` handler that writes to the workspace (e.g., `ensureDyadGitignored`, injecting synthetic todo reminders) should be guarded with `if (!readOnly && !planModeOnly)` checks. Injecting instructions that reference state-changing tools into non-writable runs will confuse the model since those tools are filtered out.
## Async I/O

- Use `fs.promises` (not sync `fs` methods) in any code running on the Electron main process (e.g., `todo_persistence.ts`) to avoid blocking the event loop.
