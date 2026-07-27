# src/ipc/pi/

Bridge layer between Dyad's Electron backend and the pi SDK
(`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`).

The chat handler delegates accepted turns to this layer while retaining stream
admission, cancellation, queueing, and durable persistence responsibilities.

## Modules

- `model_runtime.ts` — owns the pi `Models` singleton, bridges Dyad's
  `settings.providerSettings.*.apiKey` into a pi `CredentialStore`, and
  resolves `LargeLanguageModel` (Dyad's `{provider, name}`) to a pi `Model`.
- `stream_fn.ts` — wraps `Models.streamSimple` into the `StreamFn` that
  pi-agent-core's `Agent` expects, threading Dyad's thinking-budget / temperature
  / max-token settings through pi's `SimpleStreamOptions`.
- `agent_factory.ts` — factory for pi `Agent` instances tuned for Dyad's
  chat modes.
- `session_bridge.ts` — converts Dyad DB `messages` rows into pi
  `AgentMessage[]` and persists versioned transcripts.
- `chat/run_turn.ts` — executes one accepted pi agent turn behind a
  renderer-neutral event sink.
- `tools/` — selects, adapts, and executes Dyad-owned tools.

## Design notes

Dyad's provider ids and pi's built-in provider ids are already aligned for
`openai`, `anthropic`, `google`, `vertex` (as `google-vertex`), `openrouter`,
`azure` (as `azure-openai-responses`), `xai`, `bedrock` (as `amazon-bedrock`),
`minimax`. `ollama` and `lmstudio` are Dyad-only; they get injected as custom
OpenAI-compatible pi providers at runtime.

Only configured provider credentials are bridged; there is no implicit hosted
provider fallback.
