# Claude Code (Subscription) backend

Code lives in `src/claude_code/` (main process), `src/chat_backend/backend.ts`
(the narrow backend interface), and `src/shared/chat_backend.ts` /
`src/shared/claude_code_pricing.ts` (renderer-safe rules). The full design,
engine contract, and smoke-test evidence are in `docs/claude-code-integration.md`.

## Invariants

- A chat is bound to one execution backend (`chats.execution_backend`), latched
  in the same transaction as the first accepted turn. Never switch a chat's
  backend; the picker offers "Start new chat" instead, and
  `assertChatBackendCompatibleWithModel` rejects a mismatched turn before the
  user message is inserted.
- Each Claude Code chat owns an explicit CLI session id
  (`chats.claude_code_session_id`). Always pass `--resume <that id>` or
  `--session-id <freshly minted uuid>`; never `--continue` or an interactive
  picker. A missing session is a user-facing `session-not-found` error, not a
  silent new session.
- The CLI runs with `--restricted`, an explicit `--tools` allowlist, a
  `--disallowedTools` denylist, `--setting-sources ""`, `--strict-mcp-config`,
  and `--permission-prompt-tool stdio`. Every tool call still passes through `decideToolPermission`, which fails
  closed. Ask/Plan modes get only `Read,Glob,Grep`.
- `buildClaudeCliEnvironment` strips `ANTHROPIC_API_KEY`/auth-token/provider
  overrides. If the CLI's init event reports `apiKeySource !== "none"`, the turn
  is terminated and fails with `api-key-billing`; Dyad never bills an API key.
- Usage is reported per model from the CLI's `modelUsage` map (never summed
  with the aggregate `usage` block). Every turn — including cancelled and failed
  ones — writes one idempotent row to `claude_code_usage_reports`; missing usage
  is recorded as `rejected` with a reason, never as a zero-cost event.
- Usage reports use a stable `eventId` and `Idempotency-Key`; the engine
  computes the charge. Client estimates are informational only.

## Testing

- `src/claude_code/testing/fake_claude_cli.mjs` is a protocol-faithful fake CLI.
  Point `DYAD_CLAUDE_CODE_EXECUTABLE` at it (chat-flow harness) or inject
  `spawnProcess` (turn runner tests). Scenarios are selected with
  `[scenario:<name>]` in the prompt.
- `real_cli.smoke.test.ts` drives the real CLI and is gated by
  `DYAD_CLAUDE_CODE_SMOKE=1` because it spends subscription usage.
- The chat-flow harness only reloads messages for its default chat; load rows
  for additional chats directly with `harness.db`.
- When adding a bridge tool, add it to both `mcp_bridge.ts` and
  `BRIDGE_TOOL_CONSENT_POLICIES` (the bridge module throws at import time if a
  tool has no consent policy).
