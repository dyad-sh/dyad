# Better E2E: faster runs, less churn

Findings and a ranked plan from a multi-agent investigation (2026-07-06) covering: CI
timing data from recent runs (`28552805130`, `28410333771`, `28817566121`), 6 months of
git history, a full taxonomy of all 155 specs, and two working prototypes left in git
worktrees (vitest chat-flow harness; Playwright workers=2).

## Where the time and toil actually go

**Wall clock.** A healthy CI run is ~30 min; the slowest e2e shard alone is ~23 min
(77% of it). The cost is not a few slow tests: **223 of 273 tests take 10–30s each**
(avg ~16s), because every test cold-boots a packaged Electron app, clicks through
onboarding, and scaffolds an app. Fixed per-shard setup adds ~2m40s × 8 shards
(~21 machine-min/run). Shards are balanced by file count, not duration (20m–34m spread
observed).

**Red main.** Essentially **all recent e2e failures on main trace to
`visual_editing.spec.ts` (4 tests) and `cloud_sandbox.spec.ts` (1 test)** — they add
~14–20 min of retry tax to their shard (retries pile onto one worker) and turn main red
since Actions doesn't auto-retry jobs.

**Churn.** 271 of 821 commits in 6 months touch `e2e-tests/**`; **58% of those
file-touches are snapshot files**. ~9 commits/month are pure maintenance
(deflake/rebaseline), plus a nightly deflake bot. The top-4 churniest files (45, 39,
25, 22 changes) are all `snapshotServerDump(type: "request")` snapshots that embed the
verbatim `tools[].description` and `input_schema` of every tool — so a one-line prompt
tweak rewrites them all and costs a full CI round-trip + rebaseline commit. System
prompts are already masked (`[[SYSTEM_MESSAGE]]`); tool prose and model names are not.

**Test necessity.** Of 155 specs: **74 (48%) primarily assert main-process/IPC behavior**
(LLM request payloads, files/git/db state) and use the UI only as transport; 44 (28%)
are renderer flows collapsible into a few consolidated smoke specs; only **36 (23%)
genuinely need** the Electron shell, real preview dev-server, subprocesses, or pty.

**Both prototypes succeeded:**
- The real `chat:stream` handler + tag processor + git + sqlite run under plain-node
  vitest with only a `vi.mock("electron")` shim — **no main-process refactors**. The
  `dyad_tags_parsing` equivalent runs in **~1.3–2s vs 30–90s** in Playwright.
  Worktree: `.claude/worktrees/agent-a74e36967c5ee0a22`
  (`src/ipc/handlers/chat_stream_handlers.integration.test.ts`).
- **workers=2 works**: 3m05–3m15s vs 5m33s on a 26-test subset (**~1.75×**), 1 latency
  flake in 78 executions (a 15s-timeout miss under contention; CI's doubled timeouts +
  retries absorb this class). The 2026 `workers:1` revert (#3183) had no root cause; the
  old parallel config raced concurrent `tsc` builds in one dist/, which the prototype
  fixes (only webServer entry 0 builds). The fake LLM server is stateful
  (`globalCounter`, github device-flow state, per-test `/reset-repos`), so per-worker
  servers are required — and the per-worker port machinery already exists in
  `fixtures.ts:179`. Worktree: `.claude/worktrees/agent-ac83c3cc483d9d7ac`.

---

## Ranked plan

Ordered by leverage (impact ÷ effort). 1–4 are quick wins landable this week; 5–6 are
the structural wins; 7–10 are cleanups that compound.

### 1. Deflake or quarantine `visual_editing` + `cloud_sandbox` — stop red main
**Impact: removes ~14–20 min/run of retry tax and ~100% of recent main e2e failures. Effort: S–M.**
These 5 tests are the single source of recent red-main e2e. Root-cause them (all four
`visual_editing` failures reproduce in CI traces); until fixed, quarantine via
`test.fixme()` or a `@quarantine` tag excluded from the blocking run and executed in a
non-blocking nightly job. A red main that engineers learn to ignore costs more than the
coverage of 5 tests.

### 2. Mask volatile content in request-dump snapshots — kill the churn center
**Impact: neutralizes the top-4 churniest files and most of the ~9 maintenance commits/month. Effort: S (localized to `PageObject.snapshotServerDump` ~L647–760 + `helpers/utils/normalization.ts`).**
- Replace `body.tools[i].description` with `[[TOOL_DESC:<name>]]` and collapse
  `input_schema` to a stable shape hash — same policy already applied to system
  messages. Keep an opt-out for the rare test that genuinely asserts wording.
- Normalize `body.model` (and thinking-config) to `[[MODEL]]` in engine/request dumps;
  drop model names from snapshot filenames.
- Evidence: tool-prose PRs #3736/#3708/#3574/#3558/#3578 and model-bump PRs
  #3572/#3561/#3466/#3784 each rewrote these snapshots without changing what any test
  verifies.

### 3. Seed test setup via IPC instead of UI clicks — ~20–30% suite-wide
**Impact: every test pays 5–8s for `setUp()` clicking through Settings → provider →
model forms; avg quick test is ~12.8s, so setup is ~half of most tests. Effort: M.**
Seed provider/model/settings through the existing `set-user-settings` IPC path (the
pattern `pinBuildChatModeForSetup` at `PageObject.ts:319` already uses) and keep exactly
one e2e that still exercises the real onboarding UI. This is orthogonal to parallelism
and compounds with it.

### 4. Enable `workers=2` on self-hosted mac shards — ~1.6–1.75× per shard
**Impact: e2e shard wall time ~0.6× with zero extra runners. Effort: S — the patch exists in the worktree.**
The prototype adds opt-in `PLAYWRIGHT_PARALLELISM` (default 1 = no behavior change),
one fake-LLM server per worker (entry 0 builds; secondaries wait on primary `/health`,
killing the old concurrent-tsc race), and collision-proof per-worker userData dirs.
Pilot on self-hosted mac shards (10-core M4s idling at <1 core during serial runs;
they historically ran parallelism=3). Hold Windows/GitHub-hosted at 1 initially.
Before enabling for preview-heavy specs, either run a canary pass or add an env-driven
port offset to `shared/ports.ts` (vite auto-increment + stdout URL parsing + proxy
fallback should already cope, but it's untested under contention). If stable for a
week, try 3 workers.

### 5. Land the vitest chat-flow harness and migrate the payload-snapshot cluster (~18 specs)
**Impact: each migrated spec goes from 30–90s of e2e to ~1–2s of vitest; shrinks the
e2e suite where 223 × 16s lives. Effort: ~1 day harness + incremental migrations.**
The spike proved feasibility with zero main-process refactors. Productionize as:
- `src/testing/chat_flow_harness.ts` — `setupChatFlowHarness()` returning
  `{ db, appDir, chatId, streamChat(prompt), rendererEvents, dispose }` (temp userData
  via `DYAD_DEV_USER_DATA_DIR`, app's own `initializeDatabase()`, fixture-app + git
  init, provider seeding identical to what the settings UI produces).
- Shared electron mock (`src/testing/electron_mock.ts`) — the required surface is small:
  `ipcMain.handle/on`, `app.getPath/isPackaged/getVersion/on`,
  `BrowserWindow.getAllWindows/fromWebContents`, `safeStorage.*`, and a fake
  `event.sender`.
- Refactor `testing/fake-llm-server` to export `createApp(fixturesDir)` without
  `listen()` so vitest and Playwright share one implementation (until then the spike's
  ~60-line SSE stub covers the chat-completions path).
First migrations (each deletes or demotes an e2e spec): `dyad_tags_parsing`,
`dump_messages`, `smart_context_balanced/deep`, `thinking_budget`,
`context_window/manage/compaction`, `chat_mode`, `cancelled_message` — the whole
"assert the LLM request payload" cluster shares this one seam.

### 6. Continue migrating MOVABLE-IPC families as they're touched (~74 specs total)
**Impact: long-term ceiling — roughly half the suite. Effort: L, incremental.**
After the payload cluster: the `local_agent_*` tool-loop family (~24 specs;
`local_agent_handler.test.ts` already proves the pattern — keep the 4 with real
subprocess edges in e2e), app CRUD/git/fs (~12; `setupHandlerTestHarness()` +
`FakeGitService` already cover this shape today, see `app_collection_handlers.test.ts`),
git version history (~5), provider fakes (~7). Policy: when a MOVABLE-IPC spec flakes
or needs a snapshot rebase, migrate it instead of patching it. Optionally continue the
`HandlerContext` DI adoption (only ~4/57 handler files migrated) — it makes tests
lighter, but the spike shows it is not a prerequisite.

### 7. Scrub scaffold/template versions from app-file snapshots
**Impact: kills the churn class where template upgrades rewrite `copy_app`/`capacitor`/
engine snapshots (8+ changes each). Effort: S.**
Extend `generateAppFilesSnapshotData.ts`'s `package.json` handling to `<scrubbed>` all
dependency versions (today only `packageManager` + `@capacitor/*`), and route template
files whose contents aren't asserted through `STABLE_PLACEHOLDER_FILES`.

### 8. Consolidate the 44 UI-SMOKE specs into ~8–12 sweep specs
**Impact: fewer Electron boots for low-risk coverage (44 boots → ~10); less file sprawl. Effort: M.**
Natural groupings: settings-toggle sweep (~11 specs), provider/model-form sweep (~8),
nav/gallery/dialog sweep (~15), chat-input/queue sweep (~7), version-pane sweep (2).
One app boot per sweep, sequential steps inside. Combine with #3 so each sweep starts
from IPC-seeded state.

### 9. CI plumbing: drop redundant Chromium install, slim setup, balance shards
**Impact: ~2m40s fixed cost/shard (~21 machine-min/run). Effort: S.**
- Remove `playwright install` from e2e shards — tests drive the packaged Electron app,
  not Chromium.
- Cache `node_modules` keyed on the lockfile (npm ci is 38s/shard) and slim the 130 MB
  app artifact.
- Shard balancing: workers=2 (#4) smooths imbalance the cheap way; if the 20m–34m
  spread persists, feed merged-report timings into a duration-balanced shard list.
- If multiple runner agents ever share one self-hosted Mac, offset the fake-LLM port
  base per job (e.g. from `RUNNER_NAME`).

### 10. Guardrails so churn doesn't regrow
**Impact: keeps #2/#7 wins permanent. Effort: S.**
- Convention: request-dump tests assert the properties that matter (tool names offered,
  `stream: true`, message roles/order) rather than `toMatchSnapshot` on whole bodies —
  snapshots are the wrong tool when ~95% of captured bytes aren't the contract.
- When the deflake loop rebaselines the same snapshot twice, the fix is a normalization
  rule in `helpers/utils/normalization.ts`, not a re-record.
- Optional CI check: flag PRs that rewrite a request-dump snapshot by >N lines while
  touching only prompt/tool-description source files.

---

## Suggested sequencing

| When | Items | Expected effect |
|---|---|---|
| Week 1 | #1 quarantine/fix flakes, #2 snapshot masking, #9 Chromium-install removal | main goes green; churn drops immediately |
| Week 2 | #3 IPC-seeded setup, #4 workers=2 pilot on self-hosted | shard wall time roughly halves (0.7–0.8 × 0.6) |
| Weeks 3–4 | #5 vitest harness + payload cluster (~18 specs), #7 scaffold scrubbing | suite shrinks; payload tests run in seconds locally |
| Ongoing | #6 migrate-on-touch, #8 smoke consolidation, #10 guardrails | e2e converges on the 36 specs that earn Electron |

## Artifacts

- vitest harness prototype (2 passing tests, tsc/biome-clean):
  `.claude/worktrees/agent-a74e36967c5ee0a22` →
  `src/ipc/handlers/chat_stream_handlers.integration.test.ts`
- workers=2 prototype (opt-in via `PLAYWRIGHT_PARALLELISM`, `npm run e2e:p2`):
  `.claude/worktrees/agent-ac83c3cc483d9d7ac` →
  `playwright.config.ts`, `testing/fake-llm-server/start-secondary.js`,
  `e2e-tests/helpers/fixtures.ts`, `package.json`
- CI data: runs `28552805130` (green, per-step timings), `28817566121` (per-test
  durations, 273 tests). Note: report artifacts expire in 1–3 days.
- Churn data window: 2026-01-06 → 2026-07-06 (821 commits; 271 touching e2e-tests/**;
  37 pure-snapshot commits; 65 deflake/rebaseline-labeled).
