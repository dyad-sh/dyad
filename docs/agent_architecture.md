# Agent Architecture

Dyad's chat runtime is built on `@earendil-works/pi-ai` and
`@earendil-works/pi-agent-core`. Dyad retains ownership of Electron
lifecycle, persistence, security, consent, Git, and app-specific tools.

## Runtime layers

- `src/ipc/pi/model_runtime.ts`: provider/model resolution and credential
  bridge.
- `src/ipc/pi/stream_fn.ts`: provider stream options, headers, temperature,
  token limits, and reasoning settings.
- `src/ipc/pi/agent_factory.ts`: constructs the pi `Agent`.
- `src/ipc/pi/session_bridge.ts`: versioned transcript persistence and legacy
  history conversion.
- `src/ipc/pi/chat/run_turn.ts`: deep-module boundary used by the chat
  handler.
- `src/ipc/pi/chat/event_translator.ts`: converts pi events to Dyad stream
  events.
- `src/ipc/pi/tools/`: tool selection, pi adaptation, consent, and Dyad tool
  implementations.

The chat-stream handler owns stream admission, invocation identity, queueing,
cancellation, retries, durable messages, and renderer events. Pi owns the
model/tool loop inside one accepted turn.

## Tool definitions

Tools are registered in
`src/ipc/pi/tools/dyad/tool_registry.ts`. A tool definition includes:

- a stable name and model-facing description;
- a Zod input schema;
- `modifiesState` and optional context gating;
- a default consent policy and optional consent preview/metadata;
- an execution function;
- optional `<dyad-*>` XML for the renderer tool card.

`src/ipc/pi/tools/adapter.ts` converts the Zod schema to the TypeBox/JSON
Schema shape pi expects, validates refinements again at execution time, applies
blueprint and consent gates, tracks mutations, and captures renderer details.

Tool execution is sequential. Ask mode filters state-changing tools. Plan mode
exposes only read/planning tools. The active context is created per invocation
and carries app/chat identity, referenced apps, integration state, consent,
abort signal, todos, and mutation tracking.

## Adding or changing a tool

1. Read `rules/local-agent-tools.md`.
2. Add or update the implementation under
   `src/ipc/pi/tools/dyad/`.
3. Register it in `tool_registry.ts` and set `modifiesState`,
   `defaultConsent`, and `isEnabled` accurately.
4. Add a renderer card only when the existing generic tool UI is insufficient;
   route any custom XML through `DyadMarkdownParser`.
5. Add the narrowest unit or chat-flow integration test that proves execution,
   mode filtering, consent, and persistence as applicable.
6. Regenerate prompt and request snapshots when names, schemas, or
   descriptions change.

Do not use pi's built-in file or shell tools in place of Dyad definitions.
Dyad's structured file tools enforce app-root containment and protected paths;
all stateful tools retain blueprint approval, consent, mutation tracking, and
Git checkpoint behavior.

The Dyad `bash` tool is intentionally a host-authority escape hatch rather than
a path sandbox. It starts in the app root but can access anything available to
the user's OS account. Every invocation therefore requires explicit approval
of the full command, receives a secret-scrubbed environment, and is checked for
user-visible Git workspace mutations even when the command exits
unsuccessfully. Ignored dependencies and Dyad-managed internals do not trigger
checkpoints.

## History

New assistant turns persist a versioned pi transcript in
`messages.aiMessagesJson`. The session bridge verifies the stored shape
before restoring it. Supported legacy AI SDK messages are converted while
preserving text, images, thinking signatures, tool calls, and tool results.
Malformed history falls back to renderer-visible message content instead of
preventing the chat from opening.

Provider tool-call/result ordering must remain valid, especially for Anthropic.
Cancellation and failure can leave partial turns, so recovery tests must cover
restart and retry behavior rather than only a clean single turn.

## Testing

Use focused unit tests for schema conversion, provider resolution, tool
selection, event translation, and transcript conversion. Use the node
chat-flow harness for files, Git, database rows, request payloads, cancellation,
and restart semantics. Use the hybrid harness only for rendered UI behavior,
and Playwright for packaged Electron or browser-specific interactions.
