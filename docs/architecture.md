# Dyad Architecture

This document describes Dyad's current architecture as an Electron desktop application, including:

- Process boundaries
- Key modules and how they interact
- Why the current design is desktop-native and not directly portable to web/mobile

For local agent internals (Agent v2), see `docs/agent_architecture.md`.

## 1. System Shape

At runtime, Dyad is split into four major execution environments:

```txt
+-------------------+         invoke/events/streams         +----------------------+
| Renderer (React)  | <-----------------------------------> | Main (Electron/Node) |
| src/renderer.tsx  |               IPC                     | src/main.ts          |
+---------+---------+                                       +----------+-----------+
          ^                                                            |
          | contextBridge API                                          | FS, DB, child processes,
          |                                                            | git, shell, OS integration
+---------+---------+                                                  |
| Preload bridge     |-------------------------------------------------+
| src/preload.ts     |
+--------------------+

+-----------------------------+
| Worker threads (optional)   |
| workers/tsc/tsc_worker.ts   |
+-----------------------------+
```

The main process owns privileged capabilities (filesystem, process spawning, OS APIs).  
The renderer is unprivileged and can only call allowlisted IPC channels exposed by preload.

## 2. Repository Module Map

Top-level responsibilities:

- `src/main.ts`: app bootstrap, BrowserWindow lifecycle, deep link handling, single-instance behavior, auto-update setup.
- `src/preload.ts`: secure `contextBridge` surface (`window.electron`) with invoke/on channel allowlist checks.
- `src/ipc/contracts/*`: contract primitives (`defineContract`, `defineEvent`, `defineStream`) and client generators.
- `src/ipc/types/*`: domain contracts + generated clients + Zod schemas (single source of truth for IPC API shape).
- `src/ipc/handlers/*`: main-process implementations of IPC endpoints.
- `src/ipc/processors/*`: shared business processors used by handlers (for example applying model output).
- `src/db/*`: Drizzle + SQLite schema, migrations, and DB initialization.
- `src/paths/*`: path resolution for app storage (`userData`, `~/dyad-apps`, caches).
- `src/routes/*`, `src/pages/*`, `src/components/*`, `src/hooks/*`: renderer UI and behavior.
- `src/pro/*`: Pro-only features (agent loop, visual editing processors, advanced handlers).
- `workers/*`: long-running background tasks (for example TypeScript worker).

## 3. Process Boundaries and Responsibilities

### Main process (`src/main.ts`)

Main process responsibilities:

- Initializes settings backup + database.
- Registers all IPC handlers (`registerIpcHandlers()`).
- Creates and configures `BrowserWindow`.
- Handles app-level OS behavior:
  - Single-instance lock
  - `dyad://` protocol deep links (OAuth return, MCP server links, etc.)
  - Native app menu/context menu
  - Auto-update wiring

### Preload (`src/preload.ts`, `src/ipc/preload/channels.ts`)

Preload exposes a constrained bridge:

- `window.electron.ipcRenderer.invoke(...)`
- `window.electron.ipcRenderer.on(...)`
- `window.electron.webFrame.*` (zoom operations)

Channel safety model:

- Channel lists are auto-derived from IPC contracts.
- Unknown channels throw immediately in preload.
- Renderer never gets direct access to Node/Electron globals.

### Renderer (`src/renderer.tsx` + routes/components/hooks)

Renderer responsibilities:

- React UI + route composition (TanStack Router).
- Data fetching/mutations through IPC clients (TanStack Query hooks).
- Real-time UI updates from IPC events/streams.
- Rendering rich chat output (including Dyad tags in `DyadMarkdownParser`).

The renderer does not directly mutate files, run commands, or access local DB/filesystem.

### Worker(s)

- `workers/tsc/tsc_worker.ts` runs TypeScript-related background work off the main thread.
- Used to keep UI and IPC loop responsive during compute-heavy checks.

## 4. IPC Architecture

Dyad uses a contract-driven IPC model.

Core files:

- Contract core: `src/ipc/contracts/core.ts`
- Domain contracts: `src/ipc/types/*.ts`
- Handler registration: `src/ipc/ipc_host.ts`
- Typed handler runtime validation: `src/ipc/handlers/base.ts`

Supported patterns:

1. Invoke/response for standard RPC-like calls.
2. Event subscriptions for main-to-renderer pushes.
3. Stream pattern for long-running responses (`chat:stream`, `help:chat:start`).

This gives:

- Shared, typed API shape between renderer and main.
- Runtime Zod validation at IPC boundaries.
- Preload allowlist generation from contracts (reduced drift/security risk).

## 5. Core Domain Modules

Key contract domains in `src/ipc/types/`:

- `app`: app CRUD, file operations, app process lifecycle (run/stop/restart), templates.
- `chat`: chat CRUD + streaming + token counting.
- `agent`: local agent tools/events/consent.
- `github` / `git`: git operations and GitHub flows.
- `supabase` / `neon` / `vercel`: deployment/backend integrations.
- `settings`: user settings persistence.
- `system`: OS/platform/window/session/debug capabilities.
- `misc`: logs, deep links, env vars, debug bundle export.
- `plan`, `security`, `visual-editing`, `upgrade`, `mcp`: specialized feature domains.

Representative handler modules:

- `src/ipc/handlers/app_handlers.ts`: app and runtime orchestration; heavy filesystem/process work.
- `src/ipc/handlers/chat_stream_handlers.ts`: LLM streaming orchestration and response application hooks.
- `src/ipc/processors/response_processor.ts`: interprets and applies Dyad action tags to real files/dependencies/SQL.
- `src/ipc/handlers/node_handlers.ts`: Node/pnpm environment probing + install path selection.
- `src/ipc/handlers/window_handlers.ts`: window controls and platform APIs.
- `src/ipc/handlers/debug_handlers.ts`: debug bundle and screenshot capture.

## 6. Data and State

Dyad persists across multiple local stores:

- SQLite (`src/db/index.ts`, `src/db/schema.ts`) in `userData/sqlite.db`.
- Settings JSON (`src/main/settings.ts`) in `userData/user-settings.json`.
- User app source trees under `~/dyad-apps` (or test path override).

Important DB entities:

- `apps`: app metadata + integration bindings + run commands.
- `chats` / `messages`: chat history and AI turn state.
- `versions`: git/version history linkage.
- Additional tables for providers, MCP config, prompts, themes, etc.

Secrets handling:

- Sensitive settings use `electron.safeStorage` where available.
- Tokens are decrypted in main only when needed for execution flows.

## 7. Critical Runtime Flows

### A. Prompt -> streamed response -> file changes

1. Renderer calls `ipc.chatStream.start(...)`.
2. Main handler (`chat_stream_handlers.ts`) assembles context, selects model client, starts stream.
3. Stream chunks are emitted to renderer over `chat:response:chunk`.
4. Renderer renders markdown + Dyad-specific tags in real time.
5. On completion + approval, `response_processor.ts` applies file/dependency/database actions.
6. Main emits `chat:response:end`; renderer refreshes app state/preview.

### B. Run app preview

1. Renderer calls `ipc.app.runApp`.
2. Main spawns child process (host mode) or Docker flow (runtime-mode dependent).
3. Stdout/stderr is relayed via events (`app:output`).
4. Process lifecycle is tracked in `process_manager.ts` for stop/restart/reset.

## 8. Why This Architecture Is Desktop-Tied

Dyad is intentionally designed as a local, privileged desktop orchestrator.  
The following capabilities make it non-portable without major redesign:

| Capability                                   | Where it lives                                                | Why it blocks simple web portability                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Native window/app lifecycle                  | `src/main.ts`, `window_handlers.ts`                           | Browser apps cannot own app windows, native menus, close/min/max, or single-instance process locks.                       |
| Secure preload bridge                        | `src/preload.ts`                                              | The renderer depends on Electron `contextBridge` + IPC channel mediation.                                                 |
| Direct local filesystem mutation             | `app_handlers.ts`, `response_processor.ts`                    | Writes/renames/deletes project files recursively in user directories. Browsers cannot safely do this at equivalent scope. |
| Local process orchestration                  | `app_handlers.ts`, `process_manager.ts`, `runShellCommand.ts` | Spawns/kills Node/npm/pnpm/docker/git subprocesses and streams output.                                                    |
| Local SQLite with native driver              | `src/db/index.ts` (`better-sqlite3`)                          | Uses native Node bindings and local file-based DB lifecycle.                                                              |
| OS secret storage                            | `src/main/settings.ts` (`safeStorage`)                        | Relies on Electron OS encryption APIs not available in browser runtimes.                                                  |
| Custom protocol deep links                   | `src/main.ts`, `forge.config.ts`                              | Depends on OS protocol registration (`dyad://...`) and app-level URL handling.                                            |
| Auto-update and packaged distribution        | `src/main.ts`, `forge.config.ts`                              | Uses Electron packaging/signing/update channels tied to desktop installers.                                               |
| Native clipboard/screenshot/session control  | `debug_handlers.ts`, `session_handlers.ts`                    | Uses privileged OS/browser-session APIs beyond normal web sandbox guarantees.                                             |
| Bundled native resources (git binary, fuses) | `forge.config.ts`                                             | Packaged runtime assumptions are specific to Electron distribution model.                                                 |

In short: Dyad is not only a UI. It is a local orchestration runtime.

## 9. What Is Potentially Portable

If a non-desktop target were required, these parts are most reusable:

- Contract/schema design pattern (`src/ipc/types/*`, Zod schemas).
- Large portions of renderer UI, route structure, and state management.
- Model prompt composition and many pure utilities.

But core features would still require a replacement privileged backend for:

- Filesystem writes and project management.
- Process/tool execution.
- Secret management.
- Local DB and integration credential handling.

That effectively means introducing a server/agent runtime, which is a major product architecture change rather than a build-target change.
