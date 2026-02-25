# Local Agent Tool Definitions

Agent tool definitions live in `src/pro/main/ipc/handlers/local_agent/tools/`. Each tool has a `ToolDefinition` with optional flags.

## Read-only / plan-only mode

- **`modifiesState: true`** must be set on any tool that writes to disk or modifies external state (files, database, etc.). This flag controls whether the tool is available in read-only (ask) mode and plan-only mode — see `buildAgentToolSet` in `tool_definitions.ts`.
- Similarly, code in the `handleLocalAgentStream` handler that writes to the workspace (e.g., `ensureDyadGitignored`, injecting synthetic todo reminders) should be guarded with `if (!readOnly && !planModeOnly)` checks. Injecting instructions that reference state-changing tools into non-writable runs will confuse the model since those tools are filtered out.

## Async I/O

- Use `fs.promises` (not sync `fs` methods) in any code running on the Electron main process (e.g., `todo_persistence.ts`) to avoid blocking the event loop.

## Common import locations

When implementing local agent features, be aware of these common module locations:

- **Git ignore utilities**: `ensureDyadGitignored` is exported from `@/ipc/handlers/gitignoreUtils`, NOT from `@/ipc/handlers/planUtils` (which exports plan-related utilities like `slugify`, `buildFrontmatter`, `validatePlanId`).
- **Error handling**: When using `.catch()` with error handlers, always type the error parameter explicitly as `unknown` (e.g., `catch((err: unknown) => ...)`) to satisfy TypeScript strict mode.
