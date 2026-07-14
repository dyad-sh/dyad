# Dyad Sub-agent System

> Updated 2026-07-13 after reviewing OpenAI Codex commit `c39520f3d1522f2587694b52eba7d3eb39460137` and resolving the initial product decisions.

## Summary

Dyad will add a visible, root-controlled, depth-one sub-agent system with three fixed personas:

- **Explorer** is read-only, enabled by default for Pro users, and may be invoked automatically by the root model.
- **Reviewer** is read-only and never exposed as a model-callable persona. Pro users may start it with the Review UI button; a default-off setting separately controls application-triggered auto-review.
- **Implementer** uses `gpt-5.6-luna` with high reasoning, may be invoked automatically after a Pro user enables its separate default-off setting, directly edits app files, receives only controlled file-edit tools, and is limited to one exclusive writer at a time.

The design adopts independent child threads, asynchronous lifecycle controls, bounded context transfer, durable transcripts and messaging, fixed concurrency, and visible status. The root remains accountable for synthesis, verification, commits, deploys, and the final user response.

The existing root-level `explore_code` tool will be replaced immediately by `spawn_agent`; there is no compatibility period or duplicate exploration path.

## Product Decisions

These are binding decisions:

- The root is the only orchestrator. Children cannot spawn children; maximum depth is one.
- Personas are fixed to Explorer, Reviewer, and Implementer. Users cannot create arbitrary personas in the initial release.
- Sub-agents are a Pro-only capability. Non-Pro users cannot advertise, spawn, start, message, resume, or execute any sub-agent persona, including through forged or replayed calls.
- Explorer is enabled by default and may be automatically invoked by the root model.
- Reviewer is always manually available to Pro users through the Review UI button. Manual review does not enable auto-review.
- Reviewer is never available to the root model. The default-off auto-review setting lets the application—not the model—start Reviewer after a completed writable assistant turn once the writer lease is free.
- Reviewer always receives an explicit review scope.
- The Review UI button reviews the current working-tree changes since the last commit.
- Explorer and Reviewer are read-only at both tool-registration and execution time.
- Implementer directly edits files when enabled; it is not a patch-only advisor.
- Implementer has an independent `enableImplementerSubagent` setting that defaults to `false`.
- Once that setting is enabled, the root model may automatically invoke Implementer without another spawn confirmation.
- Implementer initially receives only controlled app-file mutation tools such as `write_file` and `search_replace`.
- Implementer cannot use terminal, MCP, SQL, sandbox writes, dependency installation, git, deploy, integration-management, or app-global settings tools.
- Only one Implementer may be active for an app. It acquires an exclusive app-level mutation lease; the root and other agents cannot mutate that app while it writes.
- The system allows the root plus at most three concurrently running child turns, with at most one Implementer.
- Concurrency is not initially user-configurable and spawning does not require a separate confirmation. The initial release has no Dyad-defined per-child or aggregate token, step, tool-call, or wall-time limits; usage remains visible in the UI.
- Children receive a bounded context envelope, never the complete root history by default.
- Child execution does not survive app restart initially. Active children become interrupted and their partial transcripts remain available.
- Child threads, transcripts, mailbox messages, and results are retained for the lifetime of the parent chat. There is no time-based or size-based transcript pruning in this plan.
- Root-to-child communication is durable. The root can queue messages and initiate follow-up turns on an existing child thread.
- Sub-agent activity appears in a compact, expandable inline Agent team card.
- Existing consent UI is reused with persona and task attribution.
- Future write isolation—finer-grained leases versus worktrees—remains intentionally undecided.
- If a persona's required model is unavailable, the run is blocked with setup guidance. Dyad does not silently substitute the root model or another provider model.
- Auto-review runs after a completed writable assistant turn, including an Implementer handoff, once no writer holds the lease. It requires a non-empty diff hash that has not already been reviewed.
- Review scope includes staged, unstaged, and non-ignored untracked text files under the app root compared with `HEAD`. Ignored files and binary contents are excluded; an unborn repository compares against Git's empty tree; non-Git projects cannot be reviewed initially.
- The **Review changes** button lives at the bottom of the latest assistant message, not in the code-diff UI. Its label/file count must make the repository-wide since-commit scope clear.
- Manual review reuses an existing run for the same hash and takes priority over auto-review. Auto-review is latest-wins and coalesces superseded targets instead of building a stale queue.
- If Pro entitlement is lost, reject new sub-agent operations immediately and cancel active children at the next safe boundary after any atomic file write. Preserve partial state and mark the thread `entitlement_revoked`.
- Reviewer findings expose a **Fix findings** action. A separate default-off auto-fix setting can start the same root-owned remediation automatically; existing write consent remains in force.
- When auto-review is enabled and a user message is queued behind the current assistant turn, that message waits behind a review barrier. Auto-review runs before the queued message is processed.
- If that barrier review returns current findings, show a 10-second **Fixing findings** countdown and then start root-owned auto-fix regardless of `autoFixReviewIssues`. The countdown includes **Skip fix**, does not change the persistent setting, and keeps the user message queued.
- After auto-fix, run one verification review and then release the queued user message. No findings releases it immediately; Skip fix, review/fix failure, cancellation, or an unavailable review model also releases it with the relevant status visible.

### Persona model defaults

Each persona has its own model and reasoning defaults rather than inheriting the root model:

| Persona | Default model | Default reasoning effort |
| --- | --- | --- |
| Explorer | `gpt-5.6-luna` | High |
| Reviewer | `gpt-5.6-sol` | Medium |
| Implementer | `gpt-5.6-luna` | High |

Both selected models exist in the reviewed Codex model catalog but are not currently registered in Dyad. Adding them to Dyad's model catalog/constants is therefore an implementation prerequisite. Resolve the exact persona model before scheduling; if it is unavailable for the Pro user's configured account/provider, block the run with setup guidance.

## Problem Statement

Dyad's Local Agent currently performs investigation, implementation, and self-review in one linear loop. Reconnaissance consumes root context, independent work cannot proceed concurrently, and users lack an explicit independent review checkpoint.

Dyad already has a specialized `explore_code` nested loop, but it is blocking, single-purpose, hard-coded, and lacks a durable lifecycle. This plan replaces that surface with a general child runtime while preserving Dyad's consent model, provider abstraction, live change visibility, and root-owned completion flow.

> Dyad can assemble a small, visible team of specialized agents while the root remains accountable for the overall task.

## Goals

- Let the root automatically delegate bounded research to Explorer.
- Give users an explicit, independent review action that the model cannot trigger on its own.
- Preserve root context for decisions, implementation, verification, and communication.
- Offer opt-in implementation delegation without blanket write authority.
- Make every assignment, status, message, result, error, consent request, and mutation attributable and inspectable.
- Support durable root-to-child messages and follow-up turns without respawning.
- Preserve child transcripts and partial results with the chat, including across reloads and restarts.
- Work through Dyad's Vercel AI SDK provider abstraction while requiring the exact persona defaults and clearly blocking unavailable configurations.
- Enforce Pro entitlement at model schema, IPC, manager, and tool-execution boundaries.
- Preserve normal single-agent behavior when Explorer is disabled and no other persona is invoked.

## Non-goals

- Recursive or deeply nested agent trees.
- Arbitrary or user-authored personas.
- More than one simultaneous Implementer.
- Concurrent root and Implementer writes to the same app.
- Worktree or path-level write isolation in the initial release.
- Children that continue executing after app exit.
- Autonomous or model-directed Reviewer invocation.
- Any sub-agent access for non-Pro users.
- Child commits, deploys, database mutations, integration changes, or package installation.
- Copying complete root histories into children.
- Transcript pruning or retention controls in the initial release.
- A separate full-screen orchestration workspace.

## Personas

### Explorer

**Availability:** Pro entitlement plus `enableExplorerSubagent`, default `true`. When both permit it, Explorer appears in the root model's `spawn_agent` schema and prompt guidance. Otherwise it is absent and runtime-rejected.

**Default runtime:** `gpt-5.6-luna`, high reasoning effort.

**Purpose:** Locate code, trace behavior, gather evidence, identify tests, and explain relevant architecture.

**Authority:** Read-only. Its effective tools are the intersection of the parent policy and the Explorer allowlist: targeted file/code inspection, grep, listing, reading, and the compiler-aware exploration primitives moved out of the old `explore_code` wrapper. Any tool whose effective `modifiesState` is true is excluded and runtime-rejected.

**Input:** current request, bounded assignment, intended outcome, allowed roots, a root summary, and relevant manifests.

**Report:** concise conclusion, file/line evidence, relevant flow, confidence, gaps, and recommended next action.

The root-level `explore_code` definition and prompt references are removed as soon as Explorer moves to the general runtime. `spawn_agent({ persona: "explorer" })` is the sole root-facing exploration mechanism.

### Reviewer

**Availability:** Pro users may always manually invoke Reviewer. `enableAutoReview`, default `false`, controls only application-triggered automatic review.

**Invocation boundary:** Reviewer is never part of the model-visible `spawn_agent` persona enum or autonomous prompt guidance. It may start only from:

- The Review UI button, scoped to the working-tree changes since the last commit.
- The application's deterministic auto-review trigger after a completed writable assistant turn once the writer lease is free, but only when `enableAutoReview` is true.

Manual actions and the application auto-review trigger call a dedicated internal review-start path. The root may then use durable messaging to answer a Reviewer question or request a follow-up, but it cannot originate a Reviewer thread autonomously. Auto-review must be initiated by application state, never by a hidden model tool call.

**Default runtime:** `gpt-5.6-sol`, medium reasoning effort.

**Purpose:** Independently evaluate the current code changes since the last commit against the user request and repository expectations without editing away its own findings.

**Authority:** Read-only, enforced identically to Explorer.

**Explicit review target:** Every review targets the full working-tree diff since the last commit. It includes staged, unstaged, and non-ignored untracked text files under the app root. Ignored files and binary contents are excluded. Capture at start:

- Base commit and diff hash.
- Included file list and exclusions.
- Included/excluded pre-existing changes.
- Invocation source and originating assistant turn ID for auto-review attribution.

The Review button and auto-review use the same target construction: commit SHA, file list, exclusions, and diff hash. An unborn repository uses Git's empty tree as its base. A non-Git project shows review as unavailable. There is no slash-command or free-form review-scope parser.

Reviewer waits until no Implementer holds the mutation lease. At completion, recompute the target hash. If changed, report `outdated`; do not silently broaden or substitute the scope.

**Report:** `findings`, `no_findings`, `partial`, or `outdated`; prioritized severity; file/line evidence; impact; remediation; and validation gaps. `no_findings` is not a safety certification. A current report with findings exposes **Fix findings** and the persistent auto-fix control.

### Implementer

**Availability:** only when the user is Pro, `enableImplementerSubagent` is true, the root is in writable Agent mode, no Implementer is active for the app, and the mutation lease is available. Once available, the root model may invoke it automatically.

**Default runtime:** `gpt-5.6-luna`, high reasoning effort.

**Purpose:** Complete one narrowly scoped app-file implementation task delegated by the root.

**Authority:** controlled app-file tools such as `write_file` and `search_replace`. No terminal, MCP, SQL, sandbox writes, git, packages, integrations, deployment, database mutation, settings mutation, or orchestration.

The setting permits delegation; it does not approve tool calls. Existing app-blueprint gates, consent, containment, protected paths, edit tracking, and runtime preconditions still apply.

**Input:** concrete task, acceptance criteria, explicit path scope, relevant findings, and effective policy.

**Report:** changed files, description, checks performed, denied actions, unresolved issues, and required root follow-up.

The root performs final tests, verification, commit, deploy, synthesis, and completion reporting after the lease is released.

## Capability Matrix

| Capability | Explorer | Reviewer | Implementer |
| --- | --- | --- | --- |
| Root-model automatic start | Yes | Never | Yes, when enabled |
| Application automatic start | No | When auto-review is enabled | No |
| Explicit user start | Natural request | Review button | Natural request |
| Read scoped app files | Yes | Yes | Yes |
| Modify app files | No | No | Scoped controlled edits only |
| Terminal / sandbox / MCP / SQL | No | No | No |
| Git / commit / deploy | No | No | No |
| Spawn agents | No | No | No |
| Receive durable root messages | Yes | Yes | Yes |
| Receive follow-up turns | Yes | Yes | Yes |
| Existing write consent | N/A | N/A | Required |

## Settings

For Pro users, add four independent controls under a searchable **Sub-agents** section. Do not expose functional sub-agent controls to non-Pro users; an upgrade surface may explain Pro availability, but entitlement remains enforced server-side/main-process-side as applicable.

1. `enableExplorerSubagent?: boolean`
   - Label: **Use Explorer sub-agent**
   - Copy: "Let Dyad automatically delegate read-only codebase research to Explorer. This may use additional model tokens."
   - Default: `true`.

2. `enableAutoReview?: boolean`
   - Label: **Automatically review changes**
   - Copy: "After completed turns that change code, automatically run the read-only Reviewer. You can always run a manual review with the Review changes button."
   - Default: `false` initially.

3. `enableImplementerSubagent?: boolean`
   - Label: **Allow Implementer sub-agents**
   - Badge: **Experimental**
   - Copy: "Let one delegated agent edit project files within an assigned scope. Existing tool approvals still apply."
   - Default: `false`.

4. `autoFixReviewIssues?: boolean`
   - Label: **Automatically fix review findings**
   - Copy: "After Reviewer finds issues, automatically start a root Agent turn to address them. Existing tool approvals still apply. When auto-review runs before a queued message, findings use a 10-second fix countdown regardless of this setting."
   - Default: `false`.
   - Surface the same persistent setting in both the Settings page and every current findings panel. Changing it in either location updates the same stored value. The queued-message countdown override does not mutate this value.

There is no master `enableSubagents` dependency. All four controls additionally require Pro entitlement. Enabling Implementer shows a one-time warning explaining automatic delegation, direct edits, the one-writer lease, visible attribution, and unchanged consent requirements. Do not show a second spawn-level confirmation.

Follow `rules/adding-settings.md`: schema, defaults, search IDs/index, switches, Settings placement, and snapshots.

## UX Design

### Root-directed Explorer and Implementer flow

1. The root calls model-visible `spawn_agent` with an allowed persona, stable task name, bounded assignment, and scope.
2. An inline Agent team card appears immediately; spawn returns without waiting.
3. Children run independently. The root can continue non-conflicting work, list, message, follow up, cancel, or wait.
4. Meaningful progress updates the card; private reasoning and token deltas are never shown.
5. Reports enter a bounded durable root mailbox and are persisted separately from root history.
6. The root synthesizes relevant results in its normal response.

### User-directed Reviewer flow

- A **Review changes** button appears at the bottom of the latest assistant message, outside the code-diff UI. It captures the full working-tree diff since the last commit, including the base commit, current file list, exclusions, and diff hash. Show the included file count so its repository-wide scope is not mistaken for a message-only review.
- Manual review is available to Pro users regardless of `enableAutoReview` and does not change that setting.
- When `enableAutoReview` is true, the application starts Reviewer after any completed writable assistant turn, including an Implementer handoff, once the writer lease is free. It requires a non-empty diff and skips a hash already reviewed.
- A clean working tree disables the button with a concise `No changes to review` explanation. A non-Git project disables it with a Git-history requirement. An unborn repository is reviewable against Git's empty tree.
- If a review already exists for the current hash, the button focuses that report instead of starting another run.
- Manual review has scheduling priority. Auto-review keeps only the newest requested diff hash and coalesces any superseded pending auto-review.
- Reviewer does not become model-callable merely because auto-review is enabled.
- Non-Pro users receive the normal Pro upgrade/entitlement response and cannot start a review.

### Fixing findings

- A current Reviewer report containing findings shows a primary **Fix findings** button.
- Clicking it starts a new root Agent turn with the immutable review report, target hash, and findings as bounded context. The root owns remediation and may invoke Implementer if that separate setting permits it.
- Existing Agent-mode, path, blueprint, mutation-lease, and per-tool consent rules remain canonical. The Reviewer itself never receives write authority.
- The findings panel also shows the persistent **Automatically fix review findings** setting, synchronized with the Settings page.
- When auto-fix is enabled, a current findings report automatically starts the same root remediation flow. If the chat is not writable, preserve the report and require switching to Agent mode rather than bypassing mode restrictions.
- Prevent review/fix loops: an auto-fix may trigger one verification auto-review, but findings from that verification are not automatically fixed again. They remain visible with the manual **Fix findings** button.

### Queued-message review barrier

When `enableAutoReview` is true and the user submits a message while the current assistant turn is still completing:

1. Finish the current writable turn and keep all newly submitted user messages in their existing FIFO queue.
2. Once the writer lease is free, snapshot and run auto-review before starting the first queued user message.
3. If the review reports no findings, release the first queued message immediately.
4. If it reports current findings, show a simple `Fixing findings in 10…` countdown beside the findings with a **Skip fix** action. This forced countdown applies even when `autoFixReviewIssues` is false and does not change that setting.
5. At zero, start root-owned remediation under normal Agent mode, consent, path, blueprint, and writer-lease rules while the user message remains queued.
6. Run one verification review after remediation, then release the first queued user message. Findings from this verification remain visible and are not auto-fixed recursively.

If the user selects **Skip fix**, release the queued message immediately and leave findings visible. A failed, cancelled, blocked, outdated, or unavailable-model review/fix also releases the queued message with the status shown; the barrier must never strand the user's message. Additional user messages preserve FIFO order behind the first.

### Agent team card

The inline card shows a stable row per child: persona, task, scope, status, elapsed time, latest meaningful activity, Implementer file attribution, expandable report/transcript, message/follow-up activity, stop action, and usage under progressive disclosure.

States include `queued`, `running`, `idle`, `waiting_for_writer`, `waiting_for_auto_review`, `auto_fix_countdown`, `fixing_findings`, `verification_review`, `needs_approval`, `finishing_report`, `completed`, `partial`, `review_outdated`, `stopping`, `cancelled`, `entitlement_revoked`, `interrupted_by_restart`, and `failed`.

An idle/completed child thread remains addressable for `followup_task`. A follow-up moves it back to queued/running while preserving thread history.

Reuse the existing consent banner with persona/task attribution. The card links to the canonical banner; it does not add another approval surface.

### Accessibility and errors

- Base UI primitives, keyboard-reachable controls, visible focus, text/icon status, stable row ordering, reduced motion, semantic reports, and a polite coalesced live region.
- Concurrency-full child requests queue visibly in FIFO order. Manual review is prioritized over auto-review; auto-review requests are coalesced latest-wins rather than queued individually.
- Entitlement loss rejects new work and cancels active children at the next safe boundary, preserving partial transcripts and using the terminal state `entitlement_revoked`.
- Root cancellation cancels all active children; targeted cancellation leaves siblings running.
- Restart changes active records to interrupted and preserves partial transcripts/messages.
- Stale reviews visibly say changes were made after the captured target.

## Technical Design

### Architecture

Add a root-chat-scoped `SubagentManager` in the Electron main process. It owns identity, scheduling, concurrency, cancellation, immutable policy, writer lease, durable mailboxes, threads, messages, persistence, and renderer events.

Each child runs an independent Vercel AI SDK `streamText` loop through a child-only `runSubagentTurn`, generalized from `explore_code_subagent.ts`. Do not recursively invoke or initially refactor `handleLocalAgentStream`; it contains mature root-only persistence, compaction, retry, commit, and deployment behavior.

```text
Root Local Agent
  |
  +-- SubagentManager (chat scoped, max 3 running children)
       |-- Explorer threads (read only, model-callable)
       |-- Reviewer threads (read only, button/auto-review initiated)
       +-- Implementer thread (optional, one writer lease)
```

### Immutable turn policy

At root-turn start, compute one policy containing chat mode; Explorer, auto-review, Implementer, and auto-fix settings; allowed roots; consents/tools; app-blueprint state; persona model resolution; concurrency; and the app writer-lease state.

The policy also contains an immutable Pro-entitlement snapshot. A current entitlement check is repeated at spawn/start and execution boundaries. Entitlement loss rejects new operations immediately and aborts active children at the next safe boundary after any atomic file write; persist partial state as `entitlement_revoked`.

Schema exposure, prompt hints, tool construction, IPC review starts, and runtime checks derive from this policy. Runtime must reject stale, replayed, forged, disabled, or over-authorized calls.

For Pro users, the model-visible `spawn_agent` enum includes Explorer when enabled and Implementer only when its setting and writable mode permit it. It never includes Reviewer. For non-Pro users, no sub-agent orchestration tools or persona prompt hints are exposed.

### Lifecycle, concurrency, and usage

- Maximum three running child turns per root chat; maximum one Implementer per app.
- Depth one; orchestration tools exist only on the root.
- Spawn/follow-up returns after durable registration and scheduling.
- General child work queues FIFO when all three slots are occupied. Manual reviews jump ahead of auto-reviews; pending auto-reviews coalesce to the newest diff hash.
- Per-thread abort controllers support targeted cancellation.
- Root cancellation cancels the active tree with bounded cleanup.
- Shutdown interrupts active work; startup reconciliation changes stale running states to interrupted.
- The initial release sets no Dyad-defined hard caps on child steps, tool calls, output tokens, wall time, or aggregate usage beyond provider/platform constraints.
- The Agent team card exposes worker count and measured usage. No user concurrency setting or per-spawn modal initially.

### Bounded context and durable messaging

`SubagentContextEnvelope` contains only the current request, assignment, persona, acceptance criteria, scope, allowed roots, relevant manifests, root summary, review metadata, and effective policy summary. It does not fork the complete chat.

Every child has a persistent ordered mailbox and resumable thread history:

- `send_message` durably queues a root message without starting a new model turn.
- `followup_task` durably appends an assignment/message and schedules a new turn on the existing child thread when idle.
- Messages arriving while a child is running are injected only at safe step boundaries.
- Delivery is at-least-once at the database boundary with message IDs and consumed acknowledgements; prompt assembly deduplicates IDs.
- Child reports and short model-facing projections enter the root mailbox at safe root step boundaries or via `wait_agents`.
- Full child transcripts never enter root context automatically.

On restart, active execution is not resumed automatically. Threads and queued/delivered messages remain durable and visible; the root or user may explicitly follow up after restart.

### Model-facing orchestration tools

```ts
spawn_agent({
  persona: "explorer" | "implementer", // dynamically restricted; never reviewer
  task_name: string,
  message: string,
  context_summary?: string,
  path_scope?: string[]
}) => { agent_id: string; status: AgentStatus }

send_message({ agent_id: string, message: string })
  => { message_id: string; delivery: "queued" | "delivered" }

followup_task({ agent_id: string, message: string })
  => { message_id: string; status: AgentStatus }

list_agents({}) => AgentSummary[]
wait_agents({ agent_ids?: string[], timeout_ms?: number }) => WaitResult
cancel_agent({ agent_id: string }) => { previous_status: AgentStatus }
```

Reviewer starts through a separate typed IPC/internal command authorized by a Review button click or the deterministic `enableAutoReview` application trigger. Do not route either through a hidden model tool call.

### Review targeting and remediation

Build review targets from Git, not assistant-turn attribution:

- Base is `HEAD`, or Git's empty tree for an unborn repository.
- Include staged, unstaged, and non-ignored untracked text files inside the app root.
- Exclude ignored files and binary contents while retaining bounded exclusion metadata.
- Disable review for a clean tree or non-Git project with an explanatory state.
- Key active/completed reviews by diff hash. Manual requests focus an existing matching review and outrank auto-review; pending auto-review coalesces latest-wins.

`Fix findings` and automatic fixing both start a new root Agent turn with the immutable review ID, target hash, and bounded findings projection. They do not grant Reviewer mutation authority. Auto-fix is default off and uses the same persistent setting in the findings panel and Settings page. Existing mode, consent, path, blueprint, and lease checks apply. Record the remediation origin so an auto-fix can receive one verification review without recursively launching another auto-fix.

The root chat scheduler also owns a queued-message review barrier. When auto-review is enabled, completion of a writable turn with at least one queued user message schedules review ahead of dequeuing that message. A current `findings` result creates a 10-second countdown deadline and a cancel/skip token visible to the renderer. Expiry schedules remediation ahead of the user-message queue regardless of `autoFixReviewIssues`; this override is per-event and never persists a setting change. Remediation schedules exactly one verification review, then releases the queue. Every non-success terminal path must release the barrier so user messages cannot be stranded.

### Persona definitions and model resolution

Personas are configuration over the shared runner: prompt, allowlisted tools, report schema, model/default reasoning, and whether model/user invocation is permitted.

Add `gpt-5.6-luna` and `gpt-5.6-sol` to Dyad's model constants/catalog with accurate capabilities. Resolve the exact persona model/provider before durable scheduling and record the provider, model, and reasoning on the thread. If the required model is unavailable, do not create a runnable child or substitute another model; return a handled blocked result with setup guidance.

### Implementer mutation lease

Use an app-level exclusive lease. Every state-changing invocation verifies that the Implementer owns the lease. Root writes receive a handled `writer_busy`; reads remain available. Acquisition/release must be exception- and cancellation-safe. Writes must fall inside both app root and explicit assignment scope. Scope expansion requires a new visible root assignment.

The lease supplements rather than replaces consent, containment, protected-path rules, blueprint approval, and edit tracking.

### Persistence

Add generated Drizzle migrations for:

**`agent_threads`**: ID, chat ID, persona, task name, bounded assignment/context/result, status, resolved provider/model/reasoning, measured usage, review target/hash, invocation/remediation origin, error, and timestamps. A nullable parent field may be reserved, but depth-one is enforced.

**`agent_messages`**: ID, thread ID, monotonic sequence, message ID/idempotency key, direction, role/type, bounded content/envelope, delivery/consumption state, originating root turn, and timestamps.

Persist at assignment, message, step/tool, and terminal boundaries—not token deltas. Threads/messages cascade-delete with the parent chat and otherwise are not pruned. The root chat stores only concise orchestration records and bounded result projections, not full child transcripts.

### IPC and renderer state

Use contract-driven IPC to query threads/messages, fetch reports/transcripts, start button/auto-review runs, skip a queued-message auto-fix countdown, start fix/auto-fix remediation, cancel children, send messages/follow-ups, and subscribe to batched events. Project renderer fields explicitly. Use TanStack Query for durable state and IPC events for live updates; clean global state after navigation/unmount.

### Telemetry and privacy

Record persona, resolved provider/model, counts, durations, token totals, state, invocation source (`model`, `review_button`, `auto_review`), remediation source (`fix_button`, `auto_fix`, `queued_message_override`), countdown skipped/expired, barrier duration/outcome, entitlement denial, unavailable-model blocks, and error category. Never record prompts, code, reports, or tool contents.

## Components Affected

- `src/pro/main/ipc/handlers/local_agent/tools/explore_code_subagent.ts` — generalize into `runSubagentTurn` while preserving compiler-aware internals.
- `src/pro/main/ipc/handlers/local_agent/tools/explore_code.ts` — remove immediately after `spawn_agent` replaces it; no facade.
- New `src/pro/main/ipc/handlers/local_agent/subagents/` — manager, policies, runner, personas, models, context, mailbox, persistence, and tools.
- Local Agent tool definitions/invocation — dynamic Explorer/Implementer exposure, durable messaging, writer lease, and execution guards.
- Local Agent/chat stream handlers — manager lifetime, mailbox injection, queued-user-message review barrier, priority dequeue, cancellation, and restart/shutdown reconciliation.
- Database schema and generated Drizzle artifacts — threads and durable messages.
- Typed IPC host/contracts/clients and query keys — thread queries, button/auto-review start, fix/auto-fix remediation start, messaging, cancellation, and events.
- Chat renderer — inline Agent team card, bottom-of-latest-message Review changes button, findings panel, 10-second Fixing findings countdown with Skip fix, synchronized auto-fix control, reports, queued-message barrier state, messaging/follow-ups, consent attribution, and file attribution.
- Pro entitlement/account state — hard sub-agent eligibility, upgrade messaging, and stale/replayed-call rejection.
- Settings schema/defaults/search/switches/page/snapshots — Explorer, auto-review, Implementer, and auto-fix controls for Pro users.
- Model constants/catalog — add the selected Explorer and Reviewer model defaults and capability metadata.
- Root/persona prompt builders and request snapshots — automatic Explorer/Implementer use and explicit exclusion of Reviewer.

## Implementation Plan

### Phase 1: General child runtime and immediate Explorer replacement

- [ ] Characterize current `explore_code` success, cancellation, progress, evidence, and report bounding.
- [ ] Extract `runSubagentTurn`, persona definitions, schemas, and bounded context from the child-only Explorer loop.
- [ ] Add `gpt-5.6-luna` and `gpt-5.6-sol` to Dyad model metadata and implement exact-model blocking with setup guidance.
- [ ] Implement Explorer on `gpt-5.6-luna` with high reasoning.
- [ ] Add `spawn_agent` and remove the root `explore_code` tool, prompt references, snapshots, and duplicate code path in the same change.

### Phase 2: Manager, durability, and orchestration

- [ ] Add/generate `agent_threads` and `agent_messages` schema/migration.
- [ ] Implement the manager, three-child scheduler, FIFO queue, manual-review priority, latest-wins auto-review coalescing, abort controllers, fixed depth/personas, usage measurement, and startup reconciliation.
- [ ] Implement bounded envelopes/reports and root mailbox projections.
- [ ] Implement durable `send_message` and `followup_task` with IDs, ordering, safe-boundary delivery, acknowledgement, and restart persistence.
- [ ] Add `list_agents`, `wait_agents`, and `cancel_agent`.
- [ ] Connect root cancellation and app shutdown to bounded cleanup.

### Phase 3: Explorer settings and runtime enforcement

- [ ] Add default-on `enableExplorerSubagent` with Settings UI/search/snapshots.
- [ ] Add Pro entitlement to the immutable policy and enforce it at prompt/schema, IPC, manager scheduling, follow-up, and tool-execution boundaries.
- [ ] Dynamically advertise Explorer only when enabled and runtime-reject forged/stale calls.
- [ ] Enforce depth one and read-only tool intersection at registration and execution.
- [ ] Add model guidance for automatic bounded exploration.

### Phase 4: Manual and automatic Reviewer controls

- [ ] Add default-off `enableAutoReview`; keep manual Pro review independent of the setting.
- [ ] Implement Reviewer on `gpt-5.6-sol` with medium reasoning and stable explicit targets.
- [ ] Add **Review changes** at the bottom of the latest assistant message with a repository-wide file-count label.
- [ ] Build the Git target from staged, unstaged, and non-ignored untracked text files; handle clean, unborn, binary, ignored, and non-Git cases.
- [ ] Add deterministic auto-review after completed writable assistant turns, including Implementer handoff, once the writer lease is free; deduplicate by diff hash.
- [ ] Add dedicated internal/IPC review start, entitlement validation, diff-hash validation, writer waiting, and outdated state.
- [ ] Prove Reviewer is absent from model schemas/prompts even when enabled.
- [ ] Add **Fix findings** and default-off `autoFixReviewIssues`, synchronized between each findings panel and Settings.
- [ ] Start remediation as a root Agent turn under existing consent/mode/lease rules and prevent recursive auto-fix chains after the verification review.
- [ ] Add the queued-message review barrier: auto-review before dequeue, 10-second forced auto-fix countdown on findings, **Skip fix**, one verification review, and FIFO message release.
- [ ] Ensure no-findings, skip, failure, cancellation, outdated target, entitlement loss, unavailable model, and remediation denial all release the queued message barrier.

### Phase 5: Typed IPC and inline Agent team UX

- [ ] Add typed query/review/message/follow-up/cancel/event IPC.
- [ ] Build the inline Agent team card with durable transcript/report, lifecycle, usage, message/follow-up, restart, stale-review, and cancellation states.
- [ ] Reuse consent banner with persona/task attribution.
- [ ] Add accessibility, batched progress, reload restoration, and global-state cleanup.

### Phase 6: Guarded Implementer beta

- [ ] Configure Implementer on `gpt-5.6-luna` with high reasoning and automatic model invocation when enabled.
- [ ] Add default-off experimental setting and one-time warning.
- [ ] Implement one-Implementer enforcement and exclusive app mutation lease.
- [ ] Restrict to scoped controlled file-edit tools and revalidate every write.
- [ ] Route existing consent/blueprint approval with attribution.
- [ ] Keep tests, commit, deploy, integrations, SQL, git, packages, and final reporting root-owned.

### Phase 7: Evaluation

- [ ] Add privacy-safe lifecycle, cost, cancellation, consent, review, collision, and invocation-source telemetry.
- [ ] Validate exact-model availability blocks, token overhead, cancellation, durable delivery, review catch rate, and provider compatibility.
- [ ] Enable auto-review by default later only through a deliberate product rollout; Reviewer remains absent from model tools.
- [ ] Evaluate future write isolation without committing now to path leases or worktrees.

## Testing Strategy

### Unit and integration

- [ ] Four setting defaults/search/snapshots for Pro: Explorer on, auto-review off, Implementer off, auto-fix off.
- [ ] Non-Pro prompt/schema/Settings/IPC/manager/tool boundaries expose no functional sub-agent access and reject forged, stale, replayed, message, and follow-up calls.
- [ ] Dynamic schema: Explorer model-callable when enabled; Reviewer never model-callable; Implementer only when permitted.
- [ ] Immediate absence of root `explore_code` after migration.
- [ ] Persona model and reasoning selection, capability metadata, exact-model blocking, setup guidance, and recorded resolution.
- [ ] Context/report/message bounds, mailbox ordering, idempotency, safe-boundary delivery, follow-up turns, and restart persistence.
- [ ] Manager lifecycle, three-child cap, FIFO scheduling, review priority/coalescing, root-only/depth-one enforcement, targeted/tree cancellation, entitlement-revoked cancellation, and reconciliation.
- [ ] Explorer/Reviewer can never register or execute mutation tools.
- [ ] Review button and auto-review capture all working-tree changes since the last commit and become outdated if the hash changes.
- [ ] Manual review works while auto-review is off and does not mutate the setting; auto-review deduplicates an already-reviewed diff hash.
- [ ] Review target includes staged/unstaged/non-ignored untracked text; handles clean/unborn/non-Git repositories and ignored/binary exclusions.
- [ ] Fix findings starts a root remediation turn; auto-fix shares one persistent setting across surfaces and cannot recurse after its verification review.
- [ ] With auto-review enabled, a queued user message waits for review; no findings releases immediately, while findings start a 10-second countdown and forced auto-fix regardless of the persistent setting.
- [ ] Countdown expiry performs remediation then one verification review before FIFO dequeue; **Skip fix** and every terminal error path release the message without changing `autoFixReviewIssues`.
- [ ] Implementer setting/mode/tool/scope rejection and consent-aware scoped edits.
- [ ] Exclusive lease conflict handling and cancellation-safe release.
- [ ] Child transcripts remain separate from bounded root history and cascade-delete only with chat.

### E2E

After `npm run build`:

- [ ] Pro-only automatic Explorer invocation and default-on/off setting behavior.
- [ ] Agent team card lifecycle, usage, transcript/report, message, follow-up, targeted cancellation, and tree cancellation.
- [ ] Bottom-of-latest-message Review changes button while auto-review is off, file-count/since-commit scope, and auto-review behavior.
- [ ] Findings panel Fix findings action, synchronized auto-fix setting, consented remediation, and recursive-loop prevention.
- [ ] Queue a user message during a writable turn and verify review-first ordering, visible 10-second countdown, **Skip fix**, forced fix with auto-fix disabled, verification-before-message ordering, FIFO preservation, and barrier release on failures.
- [ ] Prove normal model conversation cannot autonomously start Reviewer.
- [ ] Non-Pro users cannot start any persona through model calls, buttons, IPC replay, messaging, or follow-up.
- [ ] Navigate/reload restores durable state; restart shows interrupted without losing partial transcript/messages.
- [ ] Implementer warning, disabled/enabled request snapshots, canonical consent attribution, visible edits, and writer conflicts.
- [ ] Existing single-agent flow remains valid with Explorer disabled.

## Acceptance Criteria

- No non-Pro user can access any sub-agent persona or orchestration operation through UI, model schema, IPC, stale state, or replay.
- Explorer is enabled by default for Pro users, may be model-invoked, and uses `gpt-5.6-luna` with high reasoning.
- Reviewer uses `gpt-5.6-sol` with medium reasoning and is never exposed to or autonomously started by the root model.
- Manual Reviewer is available to Pro users while auto-review is off; `enableAutoReview` controls only deterministic application-triggered review.
- **Review changes** appears at the bottom of the latest assistant message and, like auto-review, captures staged, unstaged, and non-ignored untracked text changes since the last commit; no slash-command path exists.
- Clean and non-Git projects cannot start review; unborn repositories compare against Git's empty tree; ignored files and binary contents are excluded.
- Manual review focuses an existing matching hash and outranks auto-review; pending auto-reviews coalesce latest-wins.
- Every Review target is explicit and hashed before execution.
- Findings expose **Fix findings** and a default-off persistent auto-fix setting in both the findings panel and Settings. Remediation is root-owned, consent-gated, and cannot recurse into an automatic review/fix loop.
- With auto-review enabled, queued user messages are processed only after the preceding turn's auto-review barrier completes.
- Current findings trigger a visible, skippable 10-second auto-fix countdown regardless of `autoFixReviewIssues`; the override never changes the stored setting.
- Countdown expiry runs root remediation and one verification review before releasing the queued message. No findings, **Skip fix**, failure, cancellation, outdated review, entitlement loss, unavailable model, or denied remediation releases it immediately with status visible.
- Multiple queued user messages preserve FIFO order throughout the review barrier.
- Implementer uses `gpt-5.6-luna` with high reasoning and may be automatically model-invoked only after its Pro-only setting is enabled.
- If a required persona model is unavailable, the run is blocked with setup guidance and no fallback model executes.
- Root-level `explore_code` is removed when `spawn_agent` ships.
- Explorer and Reviewer have no runtime mutation path.
- Implementer cannot run without its independent setting, writable mode, allowed scope, and writer lease; it never bypasses consent.
- At most three children and one Implementer run concurrently; root and Implementer cannot write simultaneously.
- No Dyad-defined token, step, tool-call, wall-time, or aggregate usage caps are imposed initially; measured usage remains visible.
- Root messages and follow-up assignments are durable, ordered, bounded, and address existing child threads.
- Restart interrupts execution but preserves partial transcripts and messages; no child auto-resumes.
- Child records remain until their parent chat is deleted; no pruning is implemented.
- Every child assignment, status, report, error, consent wait, usage, message, and file change is visible and attributable.
- Child context, outputs, messages, persistence fields, and renderer payloads have hard bounds.
- Fixed personas and depth one are enforced at schema and runtime boundaries.
- The root remains the only actor that verifies broadly, commits, deploys, and declares completion.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Read-only wrapper exposes a write path | High | Immutable policy, allowlist intersection, execution revalidation, escalation tests |
| Model starts Reviewer despite the invocation contract | High | Never include Reviewer in model schema/prompt; dedicated manual/application start path; audit invocation source |
| Review covers the wrong or moving change | High | One documented since-commit target, base/hash/files, writer serialization, and outdated state |
| Root and Implementer conflict | High | One Implementer, exclusive app lease, handled root write failure, root verification |
| Persona default model is unavailable for a provider/account | High | Resolve before scheduling, block without fallback, and provide visible setup guidance |
| Non-Pro user reaches sub-agent execution through stale state or replay | High | Entitlement in schema/prompt policy plus repeated IPC, manager, messaging, follow-up, and execution checks |
| Durable messaging duplicates or loses instructions | High | Durable IDs, ordered mailbox, acknowledgement, safe-boundary injection, idempotency tests |
| Parallel children multiply cost | Medium | Three-child concurrency cap, bounded context/reports, visible measured usage, and telemetry; no token/step/time budgets initially |
| Auto-review creates stale review backlog | Medium | Diff-hash identity, manual priority, same-hash reuse, latest-wins auto-review coalescing |
| Auto-fix and auto-review loop indefinitely | High | Tag remediation origin; permit one verification review; never recursively auto-fix its findings |
| Review barrier strands a queued user message | High | One scheduler-owned release path exercised by every terminal outcome; FIFO integration tests and visible barrier state |
| Forced queued-message auto-fix surprises users | Medium | Visible 10-second countdown, clear reason, **Skip fix**, unchanged persistent setting, and canonical consent |
| No transcript pruning grows the database | Medium | Bounded message/content fields, no token-delta/event persistence, cascade delete with chat, measure growth without silently pruning |
| Crash leaves stale status | Medium | Bounded shutdown and startup reconciliation to interrupted; retain partial state |
| Implementer setting seems like blanket approval | High | Default off, warning, clear two-gate copy, canonical existing consent |

## Product Principle Alignment

- **Backend-Flexible:** orchestration uses the Vercel AI SDK, but this Pro feature intentionally requires its exact persona models. Unsupported provider/account configurations are blocked with guidance rather than silently degraded.
- **Productionizable:** Implementer writes normal files; the root owns tests, commits, and deploys.
- **Intuitive but Power-User Friendly:** Explorer helps automatically; Reviewer has one clear Review changes button plus optional auto-review/auto-fix; Implementer remains a guarded power feature.
- **Transparent Over Magical:** every child, message, cost, target, mutation, interruption, and stale result is visible.
- **Bridge, Don't Replace:** sub-agents reuse Dyad's workspace, tools, providers, diffs, settings, and consent model.

## Deferred Decision

Future write isolation—path-level leases versus worktrees—remains intentionally undecided and does not block the initial implementation. The first release uses one exclusive app-level writer lease. Revisit only if measured writer contention justifies multiple concurrent Implementers.
