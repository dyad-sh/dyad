# Dyad Architecture

Dyad is a local Electron application for building and maintaining apps with an
AI coding agent. The renderer owns the React UI. The privileged main process
owns filesystem, Git, database, process, provider, and agent execution.

## Process boundary

- The renderer is sandboxed and communicates through the typed contracts in
  `src/ipc/types/`.
- The preload allowlist is derived from those contracts.
- Main-process handlers validate requests and own privileged resources.
- Long-running renderer workflows use explicit state machines and correlated
  invocation references so stale events cannot update replacement operations.

See `rules/electron-ipc.md` for the IPC contract and security requirements.

## Life of a chat turn

1. The renderer submits a turn through the chat-stream state machine.
2. `src/ipc/handlers/chat_stream_handlers.ts` performs admission,
   idempotency, cancellation, queue, attachment, and persistence work.
3. `src/ipc/pi/chat/run_turn.ts` creates a pi agent with the selected model,
   reconstructed transcript, system prompt, and mode-appropriate tools.
4. `@earendil-works/pi-agent-core` runs the model/tool loop through the
   provider bridge in `src/ipc/pi/`.
5. Agent events are translated to Dyad's renderer-neutral stream protocol.
6. Tool results update files, databases, app processes, todos, and Git through
   Dyad-owned implementations in `src/ipc/pi/tools/dyad/`.
7. The completed pi transcript and renderer message are persisted in SQLite.

All active chat modes use this path:

- Agent (`local-agent`) exposes the full eligible tool set.
- Ask exposes read-only tools.
- Plan exposes read-only and planning tools.

Legacy stored `build` and `agent` values are migrated to `local-agent`
when settings or chats are read.

## Providers

Users configure their own providers and credentials. The model runtime in
`src/ipc/pi/model_runtime.ts` maps Dyad provider settings to pi built-ins and
registers custom OpenAI-compatible providers from database metadata. Provider
keys continue to use the existing settings and safe-storage path.

The remote language-model catalog is model-picker metadata. It does not route
chat traffic through a hosted Dyad service.

## Tools and rendering

Dyad tools use formal pi tool calls. Each `ToolDefinition` declares a Zod
schema, consent policy, state-mutation metadata, execution function, and
optional XML renderer payload. The adapter converts the schema for pi, applies
blueprint and consent gates, executes the tool, and captures renderer details.

`<dyad-*>` tags remain a presentation format for tool cards in
`DyadMarkdownParser`; they are not an executable response language.

## Persistence and recovery

Chat rows and messages remain authoritative in SQLite. The session bridge
stores a versioned pi transcript envelope in `aiMessagesJson`, rebuilds agent
state after restart, and converts supported legacy AI SDK history. Stream
admission, queueing, cancellation, retries, and durable user-input handoffs
remain outside pi so the existing lifecycle guarantees are preserved.

## App runtime

Apps live in user-controlled local directories. Main-process services manage
Git history, package installation, preview processes, the local preview proxy,
database integrations, tests, and deployments. Renderer state consumes typed
read models rather than owning process handles or filesystem authority.

## Testing

- Unit tests cover pure utilities, schemas, adapters, and transitions.
- Chat-flow integration tests exercise real SQLite, Git, IPC handlers, pi
  requests, and the deterministic fake LLM server without Electron.
- Hybrid integration tests add the real React UI and renderer IPC bridge.
- Playwright E2E tests cover packaged Electron and browser-specific behavior.

See `rules/hybrid-testing.md` and `rules/e2e-testing.md`.
