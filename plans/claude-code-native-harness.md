# Claude Code native harness (experimental)

Status: **implemented (experimental), 2026-11-13** — see the "Native tools harness" section of `docs/claude-code-shared-runtime.md` for the shipped architecture.

## Goal

New opt-in experiment: in Claude Code subscription chats, let Claude Code use
its **own native tools** (Read, Write, Edit, Glob, Grep, Bash, WebFetch,
WebSearch, TodoWrite, Task, AskUserQuestion, …) plus the user's own Claude Code
setup, instead of Dyad's equivalents. Dyad becomes the UI, lifecycle owner and
an MCP server that only offers what Claude Code lacks (preview lifecycle,
Supabase/Neon, image generation, chat history, integrations, …).

## Product decisions

| Topic                       | Decision                                                                                                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setting                     | `enableClaudeCodeNativeTools`, a nested switch shown only when `enableClaudeCodeSubscription` is on, in Settings → Experiments **and** the model picker's Claude Code submenu. One-line warning: Bash runs on your machine. |
| Scope                       | **Agent mode only**, **host runtime only**. Ask/Plan/Build, and Docker/Cloud apps, keep the current Claude Code + Dyad-tools setup; Docker/Cloud shows a short notice explaining why.                                       |
| Permissions                 | `--permission-mode auto`. Anything auto mode would prompt for is sent through Dyad's approval card.                                                                                                                         |
| User config                 | **Like the terminal**: global and project CLAUDE.md, skills, plugins, hooks, the user's MCP servers and permission rules all load. Dyad never writes to `~/.claude`.                                                        |
| Session continuity          | **One CLI session per chat**, kept across setting toggles and Agent↔Ask/Plan/Build switches. Only the offered tools change per turn. If resume fails, fall back to a fresh session with the transcript handoff.             |
| Git                         | Allowed (auto mode decides). Reconciled at turn end: Dyad commits whatever is left and records start/end commits, so Undo still goes back to before the turn. Branch switches show a warning card.                          |
| Long-running processes      | Allowed. The appended instructions say that Dyad already runs installs and the dev server/preview, and point to `restart_app`/`read_logs`. Everything Claude started is **stopped when the turn ends** or on Stop.          |
| Undo / restore              | **Rewind the CLI session** to the message that matches the restored version, so Claude forgets the undone turns.                                                                                                            |
| Mid-turn messages           | Default **Queue** (current FIFO). A secondary **Send now (steer)** action writes the message into the running turn, where it shows inline.                                                                                  |
| Dyad-configured MCP servers | **Passed directly** to the CLI as native MCP servers. Dyad's per-tool MCP consent does not apply; auto mode does.                                                                                                           |
| Subagents                   | **Native Task only.** Shown as nested cards; Dyad child-agent tools are not offered.                                                                                                                                        |
| Billing                     | Same as today: Agent + Pro reports usage, including native subagent `modelUsage`. Nothing else is charged.                                                                                                                  |

Delivery decisions (2026-11-13): one PR, with commits split by phase. Build for
all platforms, including Windows; Windows CI must exercise the native-harness
fake-CLI tests (process-tree cleanup, PowerShell/Bash tool cards). Trust auto
mode: if the CLI never sends an approval request to Dyad, that's accepted.
Real-CLI testing uses Haiku first and Sonnet only for the final end-to-end
smoke runs.

Defaults I picked (flag if wrong):

- If auto mode isn't available for the account, use `default` mode. Edits
  inside the app are auto-accepted and Bash asks through Dyad's card.
- In Agent chats, deny native `EnterPlanMode`/`ExitPlanMode` so planning stays
  in Dyad's Plan mode. `AskUserQuestion` is answered through Dyad's
  questionnaire UI.
- Steer is native-harness only for v1.

## Where we are today (verified)

- `src/ipc/services/claude_code/` already drives the user's installed CLI over
  `-p --input/--output-format stream-json` with `--restricted --tools ""`. It
  exposes the full Dyad `ToolSet` through a loopback MCP bridge
  (`tool_bridge.ts`) and checks that the init inventory is exactly the Dyad
  tools (`model.ts`).
- `ClaudeCodeModel` (`LanguageModelV3`) runs inside `handleLocalAgentStream`, so
  Dyad's finalization (commit, Supabase deploys, Neon timestamps, preview,
  consent, questionnaires, plans) already applies.
- Session reuse is gated by a fingerprint of `[appPath, system prompt, tool
schemas]` (`model.ts`). This must change for the "one session per chat" decision.
- A prototype native-tool backend (`171069cc4`) was replaced by the shared
  runtime (`868819db7`). Its `<claude-tool-card>` renderer
  (`ClaudeCodeToolCard.tsx`, `src/shared/claude_tool_cards.ts`) still exists
  for old chats only.
- Probed on CLI 2.1.319 (no inference): `initialize` accepts SDK hook
  registration (`hooks_applied: true`). `--permission-prompts host` +
  `--permission-prompt-tool stdio` route approvals to the host.
  `--system-prompt-snapshot` defaults to **on**, which freezes the system prompt
  per session. The user's default permission mode and plugins/skills load
  unless isolated.

## Architecture

This is a **policy variant of the existing `claude-code` backend**, not a new
backend. `ClaudeCodeModel`, process management, accounting, the MCP bridge and
`handleLocalAgentStream` finalization stay shared. New modules live in
`src/ipc/services/claude_code/native/`:

| Module                   | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool_policy.ts`         | One **exhaustive** table: every Dyad tool → `native-replaces(<Tool>)` / `mcp` / `omit`; every native tool Dyad knows about → card projector + guard rules. Typed against the tool registry, so a new Dyad tool fails type-check until it's classified (like `FILE_MUTATION_POLICIES`).                                                                                                                                                                                     |
| `cli_protocol.ts`        | Typed (zod, passthrough) control channel pulled out of `runtime.ts`: `can_use_tool`, `hook_callback`, `interrupt`, `mcp_message`, mid-turn user messages. Unknown events are ignored, never fatal.                                                                                                                                                                                                                                                                         |
| `permission_gateway.ts`  | Answers `can_use_tool` through the shared `src/user_input/` consent machine (allow once / always / deny), and AskUserQuestion through the questionnaire UI. Dyad's PreToolUse hook holds the few Dyad guards that apply in every mode: deny `EnterPlanMode`/`ExitPlanMode`, and deny writes into other Dyad apps' folders.                                                                                                                                                 |
| `mutation_reconciler.ts` | Live: PostToolUse on Write/Edit/NotebookEdit → file-change cards + mutation tracking. Bash → before/after `tryGetGitStateFingerprint` → `scheduleHookGeneratedFileSideEffects` (reuses `run_shell` machinery). Turn end: **the Git diff against the turn-start commit decides what changed**. It drives Supabase deploy/delete, shared-module redeploys and cloud sync, then `commitAllChanges` (with HEAD-moved / branch-switched handling). Hooks only keep the UI live. |
| `event_projector.ts`     | Turns `tool_use` / `input_json_delta` / `tool_result` / `parent_tool_use_id` into Dyad cards: Read→DyadRead, Write→DyadWrite, Edit→DyadSearchReplace, Glob→DyadListFiles, Grep→grep card, Bash→terminal card, Web\*→web cards, Task→nested subagent card, TodoWrite→todo panel, `compact_boundary`→compaction indicator. Unknown tools (user plugins, MCP) get a generic escaped-JSON card. Brings back and extends `claudeToolCardSchema`.                                |
| `session_ledger.ts`      | Per chat: CLI session id + the CLI message uuid at the end of each Dyad assistant message. Used to rewind on undo/restore/retry.                                                                                                                                                                                                                                                                                                                                           |

### CLI invocation (native Agent turn)

```
-p --tools <explicit allowlist>  --permission-mode auto
--permission-prompts host --permission-prompt-tool stdio
--setting-sources user,project,local
--append-system-prompt-file <static Dyad app context + AI_RULES.md>
--mcp-config <dyad bridge + Dyad-configured servers>   # no --strict-mcp-config
--resume <chatSession> | --session-id <new>
--include-partial-messages --forward-subagent-text
```

- **Explicit `--tools` allowlist** (never `default`), so a CLI upgrade can't
  add built-ins without Dyad knowing. Init validation becomes: Dyad server
  `dyad` connected, required native tools present, and every reported built-in
  is either known or projected generically. User MCP/plugin tools are expected.
- **Session stability:** the appended system prompt is static per app. Anything
  per-turn or per-mode goes into the user message as a reminder block: mode
  rules, selected components, referenced apps, "files were reverted to X". The
  fingerprint no longer includes tool schemas.
- Dyad-tools turns in the same chat (Ask/Plan/Build, Docker/Cloud) **resume the
  same session** with today's restricted flags. Only the tool set changes.
- Dyad-configured MCP servers are written to the per-turn 0600 temp config
  (they may contain secrets), named `dyad-<name>` to avoid clashing with the
  user's servers, and deleted after the turn.
- Bash env: start from `claudeEnvironment()` plus Dyad's resolved
  Node/package-manager PATH. No Dyad tokens.

### Dyad MCP surface in native Agent turns

- **Replaced by native:** `read_file`, `write_file`, `search_replace`,
  `list_files`, `grep`, `code_search`, `delete_file`, `rename_file`, `copy_file`,
  `git_*`, `run_shell`, `run_type_checks`, `web_search`, `web_fetch`,
  `update_todos`, `planning_questionnaire`, `spawn_agent`/`explore_code` and the
  other child-agent tools, `search_mcp_tools`/`get_mcp_tool_schema`/`execute_sandbox_script`.
- **Stay on Dyad MCP:** `restart_app`, `reinstall_and_restart_app`, `read_logs`,
  `run_build`, `add_dependency`, `execute_sql`, `get_database_table_schema`,
  `get_supabase_project_info`, `get_neon_project_info`, `add_integration`,
  `enable_nitro`, `generate_image`, `read_guide`, `search_chats`, `read_chat`,
  `explore_chat_history`, `set_chat_summary`, `write_app_blueprint`,
  `suggest_plugin`, `web_crawl`, `run_pre_commit`.

Ordering barrier: Dyad MCP tools that depend on workspace state (`execute_sql`,
`run_build`, `restart_app`, deploys) first flush pending reconciler side
effects. That way a migration written by native Write is deployed before
`execute_sql` runs.

### Lifecycle

- One turn-scoped mutation activity covers the whole native turn, because Bash
  can write at any time. Cancellation and drain behave exactly as today.
- Turn end or Stop: interrupt → SIGINT → SIGKILL the process group (existing),
  which also stops background Bash (verified on macOS). The CLI stays alive
  after `result` while a background task runs, so a native turn must end the
  process group once `result` arrives instead of waiting for the process to
  exit (today `runClaudeTurn` resolves on `close`). Verify on Linux and Windows.
- Undo/restore/retry: look up the CLI uuid for the target message and resume
  from that point (fork). If that's not possible, fall back to keeping the
  session and adding a revert notice, then to a fresh session.
- Steer: while a native turn is streaming, the composer offers **Send now**
  next to the default **Queue**. Send now writes a `user` stream-json message
  to the live CLI's stdin and adds it inline to the current turn's display.

## Phases

0. **Spikes with the real CLI** (spend a little subscription usage).
   Prerequisite: the CLI must be signed in for Dyad's clean environment.
   Check with `env -i HOME=$HOME PATH=$PATH USER=$USER claude auth status`,
   because an agent session's inherited `ANTHROPIC_AUTH_TOKEN` hides a
   signed-out machine. Run `DYAD_REAL_CLAUDE_SMOKE=1` tests with the sandbox
   off.

   **Results, 2026-11-13, CLI 2.1.325, Max plan, macOS, Haiku:** the existing
   `live_tools.test.ts` smoke passes (3/3).

   | Check                                           | Result                                                                                                                                                                                                                       |
   | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Explicit `--tools Bash,Read,Edit,…`             | Init reports exactly that list.                                                                                                                                                                                              |
   | `--permission-prompt-tool stdio` (default mode) | Bash and Edit arrive as `can_use_tool` and run after a Dyad `allow`. Read-only Bash (`cat`) is allowed without a prompt.                                                                                                     |
   | SDK hooks in `initialize`                       | `hook_callback` arrives for PreToolUse and PostToolUse on Bash and Edit.                                                                                                                                                     |
   | Same session, different tools                   | Native → `--restricted --tools ""` → native on one session id: works, and Claude recalls the exact earlier command each time.                                                                                                |
   | Rewind                                          | `--resume <id> --resume-session-at <assistant uuid> --fork-session` gives a new session that remembers only turns up to that uuid. **The flag is not in `--help`**: add a version-gated contract test and keep the fallback. |
   | `--permission-mode auto`                        | Accepted (`permissionMode: "auto"`). A network `curl` and an explicitly requested `git push --force` ran without any `can_use_tool`. A prompt routed to Dyad was not observed.                                               |
   | Background Bash                                 | **The CLI does not exit after `result` while a `run_in_background` task is alive**, and a plain SIGKILL of the CLI orphans the task. Dyad's detached spawn + process-group SIGINT→SIGKILL kills it.                          |

   Still to check: the auto-mode classifier sending a prompt to Dyad (or
   denying), and behavior on a plan without auto mode; Dyad hooks alongside
   the user's own hooks; AskUserQuestion over `can_use_tool`; mid-turn stdin
   messages; Windows (PowerShell tool, process-tree cleanup). Record sanitized
   transcripts of these runs as projector fixtures.

1. Setting, `tool_policy`, CLI args, projector, reconciler: native Agent turns
   on host. Fake-CLI integration tests.
2. Shared session across modes/toggles, session ledger, undo rewind.
3. Steer UI, Dyad MCP passthrough, nested Task cards, Docker/Cloud notice.
4. E2E (fake CLI), env-gated real smoke, docs
   (`docs/claude-code-shared-runtime.md`, `rules/claude-code-backend.md`).

## Testing

- Unit: policy exhaustiveness, projector replaying recorded CLI transcripts
  (refreshed per CLI version), permission gateway, reconciler (changes made by
  Bash and by Write, HEAD moved by Claude, branch switch), session ledger rewind.
- Integration: extend `turn.integration.test.ts` with a scripted fake CLI that
  speaks `can_use_tool` + `hook_callback`. Cover: Supabase deploy from a native
  write, undo rewind, cancel mid-Bash, Agent→Ask same-session switch, steer.
- E2E: fake-CLI Playwright spec for cards, consent, preview refresh, undo, steer.
- Real smoke: extend `DYAD_REAL_CLAUDE_SMOKE=1` to native mode.

## Known risks

- Loading the user's config means user hooks, plugins or permission rules can
  change behavior in ways Dyad can't predict. Bug reports need a "loaded
  customizations" summary (names only) in the session debug bundle.
- With "like the terminal", Bash can reach anything the user can. Dyad's guards
  are minimal by design; auto mode is the safety layer.
- Same-session tool swaps and rewind work on CLI 2.1.325, but rewind uses the
  undocumented `--resume-session-at` flag. It can change without notice, so a
  contract test must pin it and the fallback above must stay.
- Auto mode might never send a prompt to Dyad in `-p` (it may only allow or
  deny), in which case Dyad's approval card would only show in default mode.
  Still to check.
- Commercial terms for a Dyad surcharge on subscription usage are still
  unverified (same caveat as the current backend).

## Implementation notes (2026-11-13)

Where the shipped code differs from the plan above:

- **Questions and todos stay on Dyad's tools.** `AskUserQuestion` and `TodoWrite` are not in the native allowlist; Dyad's `planning_questionnaire` and `update_todos` are offered over MCP instead. That keeps questionnaire recovery and the todo panel unchanged, and CLI 2.1.325 does not ship `TodoWrite` by default anyway.
- **Approvals have no "always".** An "always allow" for a Claude Code tool would be saved where Settings cannot show or revoke it, so auto-mode prompts offer allow once / decline only.
- **The setting is always visible.** It sits under the Claude Code experiment in Settings and stays disabled until that experiment is on, so settings search can always find it. It appears in the model picker's Claude Code submenu while the subscription is enabled.
- **"Send now" lives on queued messages.** Queue stays the default; each plain-text queued message gets a Send now action while a native turn runs. Messages with attachments, selected components or a redo always wait for their own turn.
- **Guards are minimal by design.** The only Dyad PreToolUse rule blocks file-tool edits inside other Dyad apps. Plan-mode tools are kept out by the allowlist instead of a hook.
- **Verified CLI facts** (2.1.325, Max plan): see `rules/claude-code-backend.md` → "Native tools harness".
