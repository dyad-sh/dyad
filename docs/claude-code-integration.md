# Claude Code (Subscription) backend

Dyad can run a chat on the user's Claude Code subscription through the
official, unmodified `claude` CLI. Claude Code runs the agent; Dyad provides
the chat UI, a small set of controlled Dyad operations, checkpoints/preview
refresh, and usage accounting. This document is the design reference, the
engine contract for `track-usage`, and the record of the real-CLI smoke test.

## 1. Validation summary (Claude Code 2.1.260, macOS arm64)

Verified against a real `claude.ai` (Max plan) sign-in using a disposable
project before implementation:

| Capability                | How it works                                                                                                                                                                                                                                                     | Result                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-interactive streaming | `claude -p --output-format stream-json --input-format stream-json --include-partial-messages`                                                                                                                                                                    | `stream_event` text deltas, `assistant` tool_use blocks, `user` tool_result blocks, final `result`                                                       |
| Session resumption        | `--session-id <uuid>` on the first turn, `--resume <uuid>` afterwards                                                                                                                                                                                            | Resumed a codeword from a previous process; a missing id prints `No conversation found with session ID` and returns `error_during_execution`             |
| Tool restrictions         | `--restricted --tools Read,Glob,Grep[,Edit,Write] --disallowedTools Bash,...`                                                                                                                                                                                    | `init.tools` contains only the allowlist; the model reports Bash as unavailable                                                                          |
| Permission prompts        | `--permission-prompt-tool stdio --permission-mode default`                                                                                                                                                                                                       | `control_request{subtype:"can_use_tool"}` on stdout; Dyad answers with a `control_response` whose behavior is `allow` or `deny`                          |
| MCP integration           | `--mcp-config` with `{ "type": "sdk", "name": "dyad" }` plus `--strict-mcp-config`                                                                                                                                                                               | JSON-RPC (`initialize`, `tools/list`, `tools/call`) arrives as `control_request{subtype:"mcp_message"}`; no socket or child process                      |
| Settings isolation        | `--setting-sources ""` (+ `--restricted`)                                                                                                                                                                                                                        | User/project hooks, plugins, and MCP servers are not loaded                                                                                              |
| Cancellation              | `control_request{subtype:"interrupt"}`, then SIGTERM, then tree kill                                                                                                                                                                                             | Interrupt returns a `result` within ~50 ms; SIGTERM exits with 143                                                                                       |
| Auth detection            | `claude auth status` (JSON: `loggedIn`, `authMethod`, `subscriptionType`) and `init.apiKeySource`                                                                                                                                                                | `apiKeySource: "none"` for subscription auth; a signed-out CLI answers with a synthetic `Not logged in · Please run /login` message                      |
| Usage data                | `result.modelUsage` (per model: `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `costUSD`, `canonicalModel`, `costBasis: "list"`), `result.usage.cache_creation` (5m/1h split for the primary model), `result.total_cost_usd` | Auxiliary model calls (e.g. `claude-haiku-4-5-20251001`) appear as separate `modelUsage` entries and are **not** included in the aggregate `usage` block |

Commercial note: the subscription covers model usage under Anthropic's
consumer terms; Dyad adds its own charge (section 6) and never bills an API
key. Whether Anthropic's terms permit driving the CLI from a third-party app
for a given plan is a commercial question Dyad must confirm with Anthropic;
this integration does nothing the CLI's documented `-p`/SDK mode does not
already allow, and it never collects or stores Claude credentials.

## 2. Architecture

```
renderer                       main process
────────                       ────────────────────────────────────────────
ModelPicker ──selection──▶ chats.execution_backend (latched at first turn)
  Subscription / Pro credits / API key sections
  BackendSwitchDialog / ClaudeCodeChargeDialog

chat:stream ──▶ chat_stream_handlers.ts
                  ├─ dyad backend  ──▶ handleLocalAgentStream (unchanged)
                  └─ claude-code   ──▶ src/claude_code/chat_turn.ts
                                        ├─ turn_runner.ts  (ChatBackendTurnRunner)
                                        │    ├─ cli_locator.ts   (find CLI, version, auth)
                                        │    ├─ cli_process.ts   (spawn, stream-json, interrupt)
                                        │    ├─ permission_policy.ts (fail-closed tool decisions)
                                        │    ├─ mcp_bridge.ts    (in-process MCP: Dyad operations)
                                        │    └─ prompt_builder.ts
                                        └─ usage_tracking.ts (outbox + engine reporting)
```

- `src/chat_backend/backend.ts` is the narrow interface (start/resume,
  streaming text and tool events, approval requests/responses, cancellation,
  completion/errors, usage). Claude Code implements it; the Dyad agent keeps
  its existing entry point behind the same dispatch.
- Dyad keeps the visible chat history. Each Claude Code chat stores its own
  `claude_code_session_id`; resumption always uses that id and never the CLI's
  "most recent" session.
- Per-message attribution: `messages.execution_backend` plus `messages.model`
  (the resolved model id from the CLI, or null). The footer renders
  `Claude Code (<model>)`, falling back to `Claude Code (model not reported)`.
- Backend changes: `chats.execution_backend` never changes. The picker shows
  "Switching backends requires a new chat. Your current chat will stay
  unchanged." with **Start new chat** / **Cancel**; the main process rejects a
  mismatched turn before inserting the user message.

## 3. Runtime restrictions

- Launch: `claude -p --output-format stream-json --input-format stream-json
--verbose --include-partial-messages --permission-prompt-tool stdio
--permission-mode default --setting-sources "" --strict-mcp-config
--mcp-config <tmp>/mcp-config.json --restricted --tools <allowlist>
--disallowedTools <denylist> --disable-slash-commands --model <m>
--append-system-prompt-file <tmp>/append-system-prompt.md [--effort e]
(--session-id <new> | --resume <existing>)`, cwd = the app directory.
- Built-in tools: Agent mode `Read,Glob,Grep,Edit,Write`; Ask/Plan
  `Read,Glob,Grep`. Bash, PowerShell, Task/Agent (subagents), Web\*, Skill,
  ToolSearch, NotebookEdit and all scheduling/remote tools are denied.
- Every `can_use_tool` request goes through `decideToolPermission` (fails
  closed): reads confined to the app and `.env*` blocked; edits only in Agent
  mode, inside the app, never under `.git`, `node_modules`, `.dyad`, honouring
  the user's `write_file` consent; bridge tools honour their Dyad consent
  (`add_dependency` asks in chat by default).
- Environment: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, base-URL/profile
  and Bedrock/Vertex/Foundry switches are stripped. If `init.apiKeySource` is
  anything but `none`, the turn is terminated and fails with
  `api-key-billing`. Dyad never falls back to API billing or another backend.
- Disabling Bash is a tool restriction, not an OS sandbox: dependency installs,
  tests, and preview restarts exposed by the bridge still run project code.

## 4. Dyad MCP bridge (`mcp__dyad__*`)

| Tool              | Backed by                                                         | Mode  |
| ----------------- | ----------------------------------------------------------------- | ----- |
| `add_dependency`  | `installPackages` under the app coordinator (registry specs only) | Agent |
| `run_type_checks` | `runTypeScriptCheck` + Problems panel update                      | all   |
| `run_tests`       | `runAppTestsWithIsolation` (requires app testing enabled)         | Agent |
| `read_logs`       | central runtime log store                                         | all   |
| `restart_app`     | `appRunActorService.executeExternalLifecycle`                     | Agent |

Arguments are Zod-validated; unknown tools and malformed arguments return
JSON-RPC errors. The bridge is bound to one app/chat/turn.

## 5. Workflow integration

Streaming patches and tool cards (`<dyad-read>`, `<dyad-write>`,
`<dyad-search-replace>`, `<dyad-status>`, bridge cards), attachments (paths
plus inline images), selected-element context and `AI_RULES.md` (appended to
the CLI system prompt), in-chat permission prompts (shared `user_input`
machine), version checkpoints (`commitAllChanges` after every Agent-mode turn,
including cancelled ones), preview refresh (`updatedFiles`), restore/undo
through the existing version UI, and Ask/Plan read-only enforcement.

Features that use separate Dyad services (Explorer/Implementer subagents,
Engine-backed image generation, automatic review, cloud sandboxes) are not
available on this backend; they are Dyad Pro/Engine features with their own
billing and are simply absent from the Claude Code tool set.

## 6. Pricing and the `track-usage` engine contract

Rule (`src/shared/claude_code_pricing.ts`, catalog version
`2026-06-24.1`):

- Known model: **Dyad charge = 25% × API list-price cost of the measured
  tokens**, each category at its catalog rate (uncached input, cache reads,
  cache writes at the 5-minute or 1-hour rate when the CLI reports the split,
  otherwise the 1-hour rate Claude Code uses, and output including thinking).
- Unknown model: **Dyad charge = billable tokens × $0.10 / 1,000,000**, flat
  across categories, not multiplied by 25%.
- Tokens are counted once: `modelUsage` is the only source; the aggregate
  `usage` block is used solely to split the primary model's cache writes.

### Endpoint

`POST {DYAD_ENGINE_URL}/track-usage` (default `https://engine.dyad.sh/v1/track-usage`)

Headers: `Authorization: Bearer <Dyad Pro key>`, `Content-Type:
application/json`, `Idempotency-Key: <eventId>`.

Body (`ClaudeCodeUsageEvent`, `schemaVersion: 1`):

```json
{
  "schemaVersion": 1,
  "eventId": "72a990c3-5593-48fa-9290-dd2c04d21af2",
  "backend": "claude-code",
  "source": {
    "client": "dyad",
    "clientVersion": "1.13.0",
    "cliVersion": "2.1.260"
  },
  "correlation": {
    "chatId": 2,
    "messageId": 4,
    "appId": 1,
    "sessionId": "e237a8f2-c391-41a8-8d03-38173207056c",
    "turnStatus": "completed",
    "startedAt": "2026-09-05T05:28:10.000Z",
    "completedAt": "2026-09-05T05:28:15.000Z"
  },
  "requestedModel": "sonnet",
  "resolvedModel": "claude-sonnet-5",
  "models": [
    {
      "model": "claude-sonnet-5",
      "canonicalModel": "claude-sonnet-5",
      "role": "primary",
      "inputTokens": 4,
      "cacheReadTokens": 10531,
      "cacheWriteTokens": 10775,
      "cacheWrite5mTokens": 0,
      "cacheWrite1hTokens": 10775,
      "outputTokens": 149
    }
  ],
  "totals": { "billableTokens": 21459 },
  "pricing": {
    "catalogVersion": "2026-06-24.1",
    "dyadChargeRatio": 0.25,
    "unknownModelUsdPerMillionTokens": 0.1,
    "clientEstimate": {
      "listPriceUsd": 0.046704,
      "dyadChargeUsd": 0.011676,
      "perModel": [
        {
          "model": "claude-sonnet-5",
          "basis": "catalog",
          "listPriceUsd": 0.046704,
          "dyadChargeUsd": 0.011676
        }
      ]
    }
  },
  "backendReportedCostUsd": 0.0467042
}
```

Semantics the engine must implement:

- `eventId` is the idempotency key. A repeat with the same id must not debit
  again; respond `200` (or `409`) with the original outcome.
- The engine prices `models[]` itself from its catalog (falling back to the
  flat unknown-model rate) and debits the result. `clientEstimate` is
  informational (catalog drift detection); never trust it as the amount.
- `turnStatus` may be `completed`, `cancelled`, or `error`; all are billable.
- Auxiliary models (`role: "auxiliary"`) are separate rows; there is no
  aggregate row to avoid double counting.
- Responses: `200 {accepted:true, chargedUsd?}` → reported; `409` → duplicate
  (treated as reported); `402` → insufficient balance (Dyad marks the report
  rejected and blocks further Subscription turns until the user adds credits
  and retries); `401/403/404/429/5xx`/network → retried with exponential
  backoff (30 s → 1 h) from the durable outbox `claude_code_usage_reports`,
  including after an app restart; other `4xx` → rejected.
- Missing usage (crash before the `result` event, spawn failure) is recorded
  locally as `rejected` with an explicit reason and never sent as a zero-token
  event. In CLI 2.1.260 an interrupted turn returns a `result` without
  `modelUsage`, so cancelled turns are currently recorded this way too.

Credit eligibility: the Subscription backend requires a Dyad Pro key (the
billing identity). Balance enforcement is the engine's `402`; Dyad surfaces
it and never switches payment sources.

Billing UX: first-use disclosure dialog ("Claude subscription usage and a
separate Dyad charge both apply"), the pricing rule and per-turn estimates
under Settings → AI → Claude Code, a "Claude Code usage" line in the credit
tooltip, and a retry button for pending reports.

## 7. Real CLI smoke test (2026-09-05)

`DYAD_CLAUDE_CODE_SMOKE=1 npm test -- src/claude_code/real_cli.smoke.test.ts`
drives Dyad's real `chat:stream` handler with the real CLI in a disposable
app (chat-flow harness, macOS arm64, Claude Code 2.1.260, `claude.ai` Max
sign-in, model `sonnet`, engine replaced by a local contract-compatible
`track-usage` endpoint). All 7 scenarios passed:

| Scenario                                              | Evidence                                                                                                                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Streaming coding response, footer, file edit, preview | model `claude-sonnet-5`; footer `Claude Code (claude-sonnet-5)`; `<dyad-write>` card; `src/greeting.txt` created; checkpoint `c892359`; `updatedFiles: true`; session `e237a8f2-…` persisted |
| Continue after restart                                | new chat row carrying only the persisted session id resumed `--resume f9f197a4-…` and answered the codeword `TANGERINE`                                                                      |
| Cancel active turn                                    | cancelled 620 ms after Stop; partial text kept with `[Response cancelled by user]`; CLI interrupted; no `modelUsage` reported by the CLI → recorded as not billable                          |
| Bash denial                                           | model replied `NO_BASH`; Bash absent from the tool set                                                                                                                                       |
| Approved Dyad MCP operation                           | `mcp__dyad__run_type_checks` executed through the bridge (fixture app has no TypeScript, so the tool returned the "Type checking unavailable" card)                                          |
| Read-only mode                                        | Ask mode: `READ_ONLY`, no file created, no checkpoint                                                                                                                                        |
| Usage payloads and pricing                            | four completed turns reported; client list-price estimate matched the CLI's own list-price cost to 6 decimals (e.g. `0.046704` vs `0.0467042`); Dyad charge = 25% (`0.011676`)               |

Backend switching and the new-chat flow are covered by renderer tests
(`ModelPicker.test.tsx`) and the main-process precondition test in
`chat_turn.chat_flow.test.ts`; review/undo uses the unchanged version UI with
the recorded `commitHash`.

**Live charging is unverified**: the engine `track-usage` endpoint does not
exist yet; the smoke test and the integration test verify the client against
a contract-compatible local endpoint only.

## 8. Outstanding dependencies and limitations

- Engine: implement `POST /track-usage` per section 6 (idempotent, prices
  from its catalog, `402` for insufficient balance).
- Commercial confirmation with Anthropic that driving the CLI from Dyad is
  permitted for subscription plans.
- Cancelled turns: CLI 2.1.260 reports no per-model usage after an interrupt;
  they are recorded as not billable.
- Attachments inside `.dyad/media` are readable by the CLI; `.env*` files are
  blocked outright (Dyad's own agent redacts values instead).
- Windows: the fake-CLI chat-flow test is skipped (shebang script); the CLI
  itself is launched through the shared `.cmd` quoting helper, but this has
  not been exercised on Windows.
- Packaged E2E (Playwright) coverage of the picker sections is not included;
  the picker is covered by unit tests.
