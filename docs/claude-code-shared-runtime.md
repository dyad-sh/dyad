# Claude Code architecture

Claude Code owns reasoning and conversation; Dyad owns tools, permissions, presentation, and app workflows. The backend is opt-in through the top-level `enableClaudeCodeSubscription` experiment.

## Execution path

```text
Dyad chat admission → handleLocalAgentStream → ClaudeCodeModel → Claude Code CLI
                              ↑                                     ↓
                   guarded Dyad ToolSet ← host-owned MCP bridge ← tool call
```

`ClaudeCodeModel` implements the AI SDK model interface. It exposes the regular Dyad registry and dynamic third-party MCP integration through `createDyadToolBridge`, preserving normal mode/provider/feature availability. Both backends invoke the same guarded callbacks for validation, consent, execution, mutation tracking, and cards. Provider-executed SDK events prevent duplicate execution.

The CLI starts with an empty native tool set (`--tools ""`) and restricted settings, hooks, and plugins. Startup validates the exact Dyad MCP inventory and server; optional `EndConversation` is only a protocol control. Typed media results retain Dyad’s safety bounds; remote media remains links rather than being fetched implicitly.

The CLI truncates long MCP tool descriptions, which would hide the third-party MCP inventory at the end of `execute_sandbox_script`'s description. `moveOversizedToolDescriptions` keeps descriptions under the limit by moving oversized text to delimited system prompt sections and leaving a pointer on the tool.

## Turn ownership

Root MCP calls execute FIFO, so consent and questionnaires form a decision barrier without holding a workspace lock. Individual tools acquire their normal operation claims. The regular Dyad runtime owns child agents, cancellation, mutation draining, provider bookkeeping, deferred operations, Git checkpoints, and preview updates. Workflow stops use a CLI protocol interrupt to flush usage; CLI failure aborts pending tool work before cleanup and finalization. Historical native-tool cards remain readable, but only shared Dyad cards are produced now.

Referenced-app reads bind to app IDs and refresh paths under per-operation read claims after consent. Git metadata is excluded from file reads. Claude cancellation publishes completion only after owned operations drain.

## Sessions and human decisions

- **Sessions:** fingerprints bind sessions to app path, instructions, and tool schemas. Capability changes or interruption start a fresh session from bounded Dyad history, never replaying historical tool calls.
- **Questionnaires:** requests persist before parking and answers before returning; failed answer saves remain retryable. Renderer reload reconnects to the main-process invocation. Full restart marks pending requests interrupted and carries recorded answers into fresh-session context. Receipts are indexed by chat, retain the latest 50 completed outcomes, and are removed with chat history.
- **Plans:** drafts publish only after persistence. Human acceptance identifies the exact displayed version; model confirmation alone is insufficient. Handoff settles the planning turn, verifies the version, and submits an immutable snapshot as the accepted baseline. The implementation updates a separate, panel-visible working plan in its target chat; displayed messages use the plan title rather than the snapshot hash. Same/new-chat handoffs preserve backend identity. Durable admission prevents duplicate implementation; interrupted, unadmitted handoffs require renewed acceptance.

## Billing

Claude shares Codex’s external-model billing policy: Agent + Pro is eligible for Dyad charges; other modes or Pro off are unbilled by Dyad. Usage reporting is best-effort, with engine-owned settlement; no per-message accounting receipt is stored. Backend identity belongs to the chat, while actual model attribution remains per-message. Child agents use their configured provider and billing—not the Claude subscription. Production charging remains unverified.

## Native tools harness (experimental)

The nested `enableClaudeCodeNativeTools` experiment changes who owns the tools for **Agent turns on the host runtime**. Claude Code then uses its own built-in tools (Read/Write/Edit/Bash/Task/…) and loads the user's own setup (`--setting-sources user,project,local`: CLAUDE.md, skills, plugins, hooks, MCP servers, permission rules). Dyad keeps the UI, turn lifecycle, commits, deploys and billing, and its MCP server offers only what Claude Code lacks. Ask, Plan and Build, and Docker/Cloud apps, keep the Dyad-tools path above. `resolveClaudeCodeHarness` (`src/shared/claude_code_harness.ts`) is the one decision for a turn; the prompt (`constructClaudeCodeNativePrompt`), tool binding and CLI arguments all follow it.

```text
handleLocalAgentStream → ClaudeCodeModel (harness: native) → claude -p --tools <allowlist> --permission-mode auto
        ↑ finalize: commit, deploys          │  hooks + can_use_tool (stdio control channel)
        └── Git-based change tracking ←──────┤  native tool events → Dyad cards (in the text stream)
                                             └─ mcp__dyad__* → Dyad-only tools (bridge)
```

- **Tool policy** (`native/tool_policy.ts`): every Dyad tool is classified `native` or `mcp`. A test fails until a new tool is classified. The CLI gets an explicit built-in allowlist, never `default`; unknown names are ignored by the CLI, so one list spans versions. Init validation requires Read/Write/Edit, a shell (Bash or PowerShell) and Dyad's connected server. It rejects any other unlisted built-in and accepts the user's own `mcp__*` tools. Worktree, plan-mode, AskUserQuestion, TodoWrite, cron/remote and agent-team tools are excluded; Dyad's `planning_questionnaire` and `update_todos` are offered instead.
- **Control channel** (`runtime.ts`, `native/control_handler.ts`): `initialize` registers Dyad's PreToolUse/PostToolUse hooks next to the user's own. Control requests are answered beside the ordered event stream, so a parked human decision cannot stall it. Auto-mode approvals use Dyad's consent card without "always": a saved approval for a Claude Code tool could not be shown or revoked in Settings. PreToolUse only blocks file-tool edits inside other Dyad apps.
- **Change tracking** (`native/mutation_tracker.ts`): hooks only mark the turn dirty; the Git state fingerprint against turn start decides what changed. Side effects (Supabase deploys/deletes, shared modules, cloud sync) are scheduled before workspace-dependent Dyad tools and at turn end. The finalizer's normal commit then records the turn, including when Claude made its own commits. The whole native run is one tracked mutation activity.
- **Presentation** (`native/event_projector.ts`): native tool events become `<dyad-claude-tool>` cards, written into the same text stream as Claude's words so they stay in order. They bypass the model-text filter, which only exists to neutralize markup the model writes. Subagent steps fold into one card. Dyad's own MCP tools render their own cards.
- **Lifecycle**: a background Bash task keeps the CLI alive after its `result`, so native turns stop the process group 1.5 s after the result; that also ends anything Claude started in the background.
- **MCP servers** (`native/mcp_passthrough.ts`): Dyad-configured stdio/HTTP servers are written into the per-turn 0600 MCP config as `dyad-<name>`. OAuth servers stay proxied through Dyad's bridge, because Dyad owns their token refresh.
- **Sessions** (`native/session.ts`): once native tools are enabled, a chat keeps one CLI session across prompt, tool, harness and mode changes ("continuity"; `--system-prompt-snapshot off` so each turn's prompt applies). Only the app must match. A per-message ledger maps each answered Dyad message to its last top-level CLI assistant uuid. When the last answered message is gone (undo, restore, retry), the next turn resumes with `--resume-session-at <uuid> --fork-session` and adopts the fork's session id from init. Forks keep the original uuids, and `modelUsage` stays cumulative across forks, so the billing baseline carries over.
- **Send now** (`native/steer_registry.ts`, `claude-code:steer`): a queued text message can be removed from the queue and written into the running turn's stdin; the CLI folds it into the same turn. Steering closes at the main thread's `end_turn`, and an undelivered message is resubmitted, so nothing runs twice or is lost.

Verification: `runtime_native.test.ts` runs a fake CLI as a real process tree on every platform (Windows CI included). `turn_native.integration.test.ts` covers the chat harness. `DYAD_REAL_CLAUDE_SMOKE=1` runs `live_native.test.ts` (real CLI, Haiku) and `e2e-tests/claude_code_native.spec.ts` (packaged app, Sonnet).
