# Hybrid harness improvements — implementation plan

Plan for items 1–9 from the critical evaluation of the hybrid renderer+IPC
harness (PR #3807; shared node-layer infra also in #3801). Each item has
motivation with evidence, a concrete design, files, verification, effort, and
risks. Sequencing and PR strategy at the end.

Baseline context: the harness lives in `src/testing/hybrid_chat_harness.tsx`,
`src/testing/renderer_ipc_bridge.ts`, `src/testing/electron_mock.ts`, with docs
in `src/testing/HYBRID_HARNESS.md`. 16 hybrid tests live in
`src/ipc/handlers/__tests__/*.integration.test.ts` (same suffix as the node
tests — see item 2). All file references below are as of #3807.

---

## 1. Real Node fetch for main-process HTTP (kills both fidelity limits)

**Problem.** Under the happy-dom environment, `globalThis.fetch` is happy-dom's
browser-emulating fetch. Main-process code (the AI-SDK model client) inherits
it, causing both documented limitations:

- CORS-forbidden request headers (`Authorization`) are stripped — the `engine`
  pilot conversion failed on `dump.headers === {}` and was reverted; all
  engine/gateway/header tests are node-only today (HYBRID_HARNESS.md §10).
- Aborting the chat `AbortController` doesn't reliably tear down an in-flight
  fetch — the abort is only observed when the next chunk arrives.
  `local_agent_cancel_todos` failed 4/6 parallel runs and was reverted.

**Design.**

1. Add `undici` as a devDependency (Node's own fetch implementation, importable
   regardless of what happy-dom did to the global).
2. Add a test-only fetch seam in `src/ipc/utils/get_model_client.ts`:

   ```ts
   // module scope
   let testFetchOverride: typeof fetch | undefined;
   export function setModelClientFetchForTesting(f: typeof fetch | undefined) {
     if (process.env.NODE_ENV === "production") return; // inert in prod
     testFetchOverride = f;
   }
   ```

   Thread `fetch: testFetchOverride` into every provider factory call that
   accepts it (`createOpenAI`, `createAnthropic`, azure, engine/gateway client
   construction — audit all creation sites in `get_model_client.ts`). The AI
   SDK providers all accept a custom `fetch` option.

3. `setupHybridChatHarness()` calls
   `setModelClientFetchForTesting(undiciFetch)` during setup and resets it in
   `dispose()`. The node harness does NOT need it (real Node fetch already).
4. Update HYBRID_HARNESS.md §10: delete the header-stripping and
   cancel-mid-stream entries; note that non-LLM fetches (desktop-config,
   catalog) still go through happy-dom (they're faked/benign).

**Verification.**

- New harness smoke assertion: run a `[dump]` prompt through the hybrid
  harness and assert `getServerDump().headers.authorization` is present
  (this is exactly what failed in the engine pilot).
- Re-convert `local_agent_cancel_todos` to hybrid (the previous conversion was
  fully written and passed standalone — recover it from the workflow agent's
  transcript or redo; it failed only under parallel contention). Run the 5-file
  parallel repro that killed it: 6 consecutive runs, all green.
- Full hybrid suite green twice.

**Effort:** ~half a day. **Risk:** low — the seam is inert in production; the
audit of provider-creation sites is the only fiddly part. Do NOT try to patch
`globalThis.fetch` instead: renderer code legitimately needs happy-dom's fetch.

---

## 2. Vitest project for hybrid tests (kill the preamble + pragma traps)

**Problem.** Every hybrid test carries ~30 lines of copy-paste: two
`@vitest-environment` pragmas that MUST be the first lines of the file (a JSDoc
above them silently swallows the options line — a documented trap), plus the
`vi.hoisted` + three `vi.mock` calls (electron, posthog-js/react,
react-i18next). At 16 tests it's noise; at 60 it's a maintenance liability.
Also: hybrid and node tests share the `.integration.test.ts` suffix — you
cannot tell which harness a test uses without opening it.

**Design.**

1. Rename the 16 hybrid tests `*.integration.test.ts` → `*.hybrid.test.ts`
   **and their snapshot files** (`__snapshots__/<name>.snap` is keyed by test
   filename — `chat_mode`, `context_compaction`, `security_review` have snaps).
   Keep describe/it names unchanged so snapshot _contents_ stay identical.
2. Split vitest config into two projects (vitest `test.projects` /
   workspace):
   - **unit** (existing behavior): current include, minus
     `src/**/*.hybrid.test.ts`.
   - **hybrid**: include `src/**/*.hybrid.test.ts`, `environment: "happy-dom"`,
     `environmentOptions: { happyDOM: { settings: { fetch: {
disableSameOriginPolicy: true } } } }`, `setupFiles:
["src/testing/hybrid.setup.ts"]`, forks pool (explicit, since parallel
     safety depends on process-per-file).
3. `src/testing/hybrid.setup.ts` registers the shared mocks:

   ```ts
   import { vi } from "vitest";
   export const h = vi.hoisted(() => { ... ipcHandlers map + NODE_ENV ... });
   vi.mock("electron", async () => { ... });
   vi.mock("posthog-js/react", () => ({ ... }));
   vi.mock("react-i18next", () => ({ ... }));
   ```

   **Validation gate (do this FIRST, 30 min):** confirm `vi.mock` registered in
   a setupFile applies to modules imported by the test file under the forks
   pool. Spike with one converted test. If it does not work, fall back to:
   keep `vi.mock` in test files but still move environment/environmentOptions
   into the project (that alone removes the two pragma-trap lines and the
   env options JSON), and export a `hybridTestPreamble()` snippet doc.

4. The hoisted `h` handle: tests need it to pass `electronMock: h` into setup.
   Export it from the setup module (`import { h } from "@/testing/hybrid.setup"`),
   or — cleaner — have `setupHybridChatHarness()` default `electronMock` to a
   module-level singleton that the setup file populates.
5. Update both cookbook docs; delete the pragma-trap warnings (no longer
   possible to get wrong).

**Verification.** All 16 renamed tests green under `npx vitest run --project
hybrid`; unit project unchanged (same file count as before minus 16);
`npm run test` runs both projects; snapshots byte-identical (git status clean
on `__snapshots__` after the rename).

**Effort:** ~half a day including the validation gate. **Risk:** the
setupFile-mock behavior is the unknown — hence validate first. CI: `npm run
test` already runs vitest at the repo root; projects are transparent to it.

---

## 3. Per-mount jotai store isolation

**Problem.** `mount()` seeds `getDefaultStore()` (the app's global store) and
`dispose()` resets exactly 4 hand-picked atoms
(`selectedChatIdAtom`, `selectedAppIdAtom`, `chatInputValuesByIdAtom`,
`chatMessagesByIdAtom` — hybrid_chat_harness.tsx `dispose()`). Every other
atom written during a test (todos, proposal state, banners, version pane)
leaks into the next `it` in the same file. This is the classic
"green at 16 tests, flaky at 60" defect.

**Design (preferred).** Wrap the mounted tree in a jotai
`<Provider store={createStore()}>` with a fresh store per `mount()`:

- Harness keeps `let activeStore: ReturnType<typeof createStore>` set by
  `mount()`; `typeInChat` and any atom seeding write to `activeStore`, not the
  default store.
- `dispose()` drops the reference; no reset lists to maintain, ever.

**Decision gate first (1 hour):** `grep -rn "getDefaultStore" src/` outside
`src/testing`. Components under a `<Provider>` use the Provider store, but any
_imperative_ app code calling `getDefaultStore().set(...)` (e.g. IPC listeners
registered outside React, atom-effect helpers) would write to the default
store while components read the Provider store — a split-brain. Findings:

- If imperative uses are absent or confined to code the harness doesn't mount:
  proceed with the Provider design.
- If present in mounted paths: either (a) refactor those call sites to receive
  the store (small product change, listed per-site in the PR), or (b) fallback
  design: stay on the default store but snapshot-and-restore it — maintain a
  `SEEDED_ATOMS` list co-located with the harness plus a runtime dev-check
  that warns when `store.get` sees a non-reset atom holding non-initial state
  across mounts (jotai exposes no store-wide reset; the warning keeps the
  reset list honest).

**Verification.** New harness self-test: two `it`s in one file — first writes a
non-reset atom (e.g. seeds todos via a stream), second asserts pristine state.
This test FAILS on today's harness (proving the leak) and passes after.
All 16 hybrid tests green twice.

**Effort:** half a day to a day depending on the grep findings. **Risk:**
medium — the split-brain failure mode is subtle; the decision gate exists to
catch it before committing to the design.

---

## 4. Complete the mount tree: ThemeProvider + Toaster

**Problem.**

- Any canned assistant response containing a code span renders `CodeHighlight`
  → `useTheme()` throws `useTheme must be used within a ThemeProvider` → route
  error boundary ("Something went wrong!"). `security_review.hybrid.test.ts`
  carries a per-test `vi.mock("@/contexts/ThemeContext")` workaround; every
  future test with code in fixtures will hit this.
- Toasts have nowhere to render (no `<Toaster>` in the tree), so `undo` had to
  drop the node test's `{successMessage: "Restored version"}` assertion — the
  revert-version result feeds a sonner toast.

**Design.** In `mount()`'s wrapper, compose the real providers:
`<ThemeProvider><QueryClientProvider>...<Toaster /></QueryClientProvider></ThemeProvider>`
(match the nesting order the real app uses in `renderer.tsx` / root route —
read it, don't guess). Then:

- Delete the ThemeContext mock from security_review.
- Restore the undo toast assertion: `await screen.findByText("Restored
version")` (sonner renders into the tree; verify it works under happy-dom —
  if sonner's portal/animation fights happy-dom, assert via its aria-live
  region instead; timebox 1h, else keep the git-log assertions and note it).

**Verification.** security_review green with the mock deleted; a new smoke
assertion mounting a fixture with a code block (no error boundary); undo's
toast assertion restored or the fallback documented.

**Effort:** 2–4 hours. **Risk:** low; sonner-under-happy-dom is the only
unknown, and it's timeboxed with a fallback.

---

## 5. Event-driven bridge + invoke result log + settle diagnostics

**Problem.** Three related bridge gaps (renderer_ipc_bridge.ts):

- `waitForEvent` polls `bridge.sentEvents` (a growing array) via RTL `waitFor`
  — O(n) rescans on a polling interval instead of resolving on arrival.
- `invoke` results are discarded, so `cancelled_message` could not assert the
  `chat:cancel` envelope `{ok: true, value: true}` the node test asserted
  (documented as a workflow gap).
- `settleInFlight` returns silently on timeout — a stuck handler is
  indistinguishable from success, and you can't tell WHICH channel is stuck.

**Design.**

1. Add `once(channel, predicate?, timeoutMs?)` to the bridge: a real
   subscription resolved by `send()` at dispatch time (no polling). Rebuild
   `waitForEvent`/`waitForStreamEnd`/`waitForNextStreamEnd` on it; keep
   `sentEvents` + `eventCount()` for debugging and baselines (API-compatible —
   no test changes required).
2. Track invokes as `{channel, args, status, result?, error?, settledAt?}` in
   `bridge.invokeLog` (replace the bare `inFlight` Set with a Map from promise
   → entry). Expose `lastInvoke(channel)`.
3. `settleInFlight` on timeout: `console.warn` (or throw behind an option) the
   pending channels from the Map — e.g. `settleInFlight timed out; pending:
["chat:stream", "get-proposal"]`.
4. Update `cancelled_message.hybrid.test.ts` to restore the envelope
   assertion via `bridge.lastInvoke("chat:cancel")`.

**Verification.** All 16 hybrid tests green (waits API-compatible);
cancelled_message asserts the envelope again; a forced-timeout unit test for
the settle diagnostics message.

**Effort:** 2–4 hours. **Risk:** low; keep the old polling path deletable in
one commit so a revert is trivial if `once` misbehaves under `act`.

---

## 6. Read engine/gateway env vars at call time (kills the hoisted-relay boilerplate)

**Problem.** `src/ipc/utils/get_model_client.ts` (~line 39) captures
`process.env.DYAD_ENGINE_URL` (and gateway URL) at module import;
`src/ipc/utils/lm_studio_utils.ts` does the same for its base URL. The
harness's fake-server port only exists after app modules load, so every
pro/engine/lm-studio test — node AND hybrid — carries a `vi.hoisted` block
that reserves a port and runs a relay server before imports (pattern
documented in HYBRID*HARNESS.md §9 and used by `engine`, `thinking_budget`,
`lm_studio`, `turbo_edits_v2`, `context*\*`, `local_agent_code_search` tests).

**Design.** Move the env reads inside the functions that use them (or a
`getDyadEngineUrl()` helper reading env per call). Audit for other
import-time-frozen env reads on the model-routing path (`DYAD_GATEWAY_URL`,
`LM_STUDIO_BASE_URL_FOR_TESTING`; also note `getEnvVar`'s `shellEnvSync` cache
in `src/ipc/utils/read_env.ts` — leave the cache but document it). Runtime
cost is a property read per request — negligible against an LLM call.

Then simplify the tests: replace hoisted relays with `beforeAll` env
assignment of the harness's real port. Add a harness option
(`engine: true` → sets `DYAD_ENGINE_URL`/`DYAD_GATEWAY_URL` to the fake server
before seeding settings) so future engine tests are one flag.

**Verification.** All relay-using tests rewritten and green twice; grep
confirms no `vi.hoisted` relay pattern remains; e2e unaffected (Playwright
sets these env vars before app launch, so call-time reads see identical
values).

**Effort:** ~half a day (small product change, then N test simplifications).
**Risk:** low; the only behavior change is WHEN env is read, and both e2e and
production set these before any request. Note: the node tests live on #3801 —
see sequencing.

---

## 7. Share AppRoot's renderer event wiring

**Problem.** Global main→renderer subscriptions live in `renderer.tsx`'s
AppRoot (e.g. `agent-tool:todos-update` → `agentTodosByChatIdAtom`, todos
cleared on stream start). The harness mounts only ChatPanel, so that wiring is
absent: ChatInput's TodoList never populates, and the reverted cancel_todos
conversion had to hand-replicate the listener — asserting a copy of the
wiring, not the app's.

**Design.**

1. Read `renderer.tsx` and enumerate AppRoot's IPC subscriptions. Extract them
   into `src/app_wiring/registerRendererIpcListeners.ts` (exact name/location
   to match repo conventions): a function taking `(ipcClient, store)` and
   returning an unsubscribe closure. AppRoot calls it in its effect —
   behavior-identical refactor, no logic changes.
2. Harness `mount()` gains `wireAppEvents?: boolean` (default **true** — the
   real app always has this wiring; opting out is the artificial state) that
   calls the same function against the bridge-backed ipcClient and the
   mount's store (dovetails with item 3), and unsubscribes in cleanup.
3. Filter list: if some AppRoot listeners are inappropriate under test
   (deep-link handlers, auto-update prompts), the extracted function takes an
   allowlist parameter; the harness passes the chat-relevant subset and the
   app passes "all". Keep the subset definition in the harness, not the app.

**Verification.** Behavior-identical for the app (manual: `npm start`, check
todos/deep-link still work; the e2e suite covers this too). New hybrid
assertion: a todos-producing fixture populates the real TodoList in the DOM
(this is exactly what the reverted conversion couldn't do cleanly). With item
1 also landed, re-attempt the full `local_agent_cancel_todos` hybrid
conversion using the real wiring.

**Effort:** ~half a day. **Risk:** medium-low — it refactors production
renderer bootstrap; keep the extraction mechanical (cut/paste, no reordering)
and rely on e2e for regression cover.

---

## 8. Root-cause the post-stream double-render

**Problem.** Around `chat:response:end`, assistant text transiently exists in
two DOM nodes (streamed rendering + persisted re-render), so `getByText` throws
"found multiple elements". Tests work around it with
`getAllByText(...).length > 0` (context_compaction). Unknown whether this is a
test-mode artifact or a real production flash.

**Design.**

1. Investigation (timebox ~1 hour): in the hybrid harness, log render sources
   around stream end — likely the streamed message (jotai
   `chatMessagesByIdAtom` updated by chunks) and the react-query refetch of
   persisted messages (invalidated on response:end) coexisting for a frame.
   Check whether `MessagesList`'s keying/replacement logic dedupes by message
   id and whether the non-Virtuoso `isTestMode` path differs from the Virtuoso
   path here.
2. Outcome A — real production flash: file an issue with the trace (the
   harness just earned its keep); fix in MessagesList if cheap (key streamed
   and persisted renderings of the same message identically).
3. Outcome B — test-mode artifact: add `waitForRenderedText(text)` to the
   harness — waits until the text exists AND the match count is stable (e.g.
   equals 1, or unchanged across two animation frames). Replace the
   `getAllByText` workarounds and document in the cookbook.

**Verification.** Either the issue/fix with a repro, or the helper adopted in
context_compaction with the workaround comment deleted; 16 tests green twice.

**Effort:** 2–4 hours. **Risk:** none beyond the timebox.

---

## 9. Guardrails: double-setup, missingChannels, failure DOM dump

**Problem.** Three silent failure modes:

- A second `setupHybridChatHarness()` in one process corrupts state silently
  (the app db is a process singleton) — nothing enforces the one-per-file rule.
- `bridge.missingChannels` is great diagnostics but only helps if a test
  remembers to assert it (only some do).
- On failure there's no DOM state captured — e2e attaches screenshots; hybrid
  failures give you an assertion message and nothing else.

**Design.**

1. Module-level guard in both harnesses: `setupChatFlowHarness` /
   `setupHybridChatHarness` throw
   `"Second harness setup in one process — one harness per test FILE (forks
pool isolation); split the file"` if called again without `dispose()`
   having FULLY completed (flag set at entry, cleared at end of dispose).
2. `dispose()` asserts `missingChannels` is empty by default
   (`assertNoMissingChannels: true` option to opt out) — a UI invoking an
   unregistered channel is always a bug worth failing on. Remove the now
   redundant per-test assertions.
3. In the hybrid setup file (item 2's `hybrid.setup.ts`): register
   `onTestFailed(() => console.error(prettyDOM(document.body, 20_000)))`
   (RTL `prettyDOM`, capped) plus the last 20 `bridge.sentEvents` channels —
   the two things you always want when a hybrid test fails in CI.

**Verification.** Unit test for the double-setup throw; one test intentionally
invoking a bogus channel proves the dispose assertion fires; force a failure
locally and confirm the DOM dump renders usefully in output.

**Effort:** 2–3 hours. **Risk:** none. (2) could surface latent missing
channels in existing tests — if so that's signal, not noise; fix or opt out
per test with a comment.

---

## Sequencing and PR strategy

**Precondition:** land #3801 and #3807 first (this plan touches files in
both; doing it before they merge means three-way conflicts).

Then three follow-up PRs, in order:

| PR                      | Items                                                  | Rationale                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: "harness infra"      | 2 (projects/setup/rename), 5 (bridge), 9 (guards)      | Pure test-infra, no product code. Item 2's rename touches every hybrid file — do it first so later PRs diff against final names.                                                                          |
| B: "fidelity"           | 1 (fetch seam), 4 (providers), 6 (env call-time)       | Small product touches (`get_model_client`, `lm_studio_utils`, mount tree). 1+6 together let engine-class tests drop relays AND run hybrid where DOM-relevant; re-convert `local_agent_cancel_todos` here. |
| C: "isolation & wiring" | 3 (jotai store), 7 (AppRoot wiring), 8 (double-render) | The two decision-gated items plus the investigation. 7's harness side depends on 3's store handling, so they ship together.                                                                               |

Each PR's gate: full vitest suite (both projects) green twice locally, the
three snapshot files byte-identical unless a change is explicitly justified,
`ts:main`/oxlint/oxfmt clean, and — for B and C which touch product code — a
normal e2e CI run.

**Decision gates recap (cheap, do before committing to designs):**

- Item 2: does `vi.mock` in setupFiles apply under the forks pool? (30 min
  spike; fallback defined.)
- Item 3: `grep getDefaultStore src/` — Provider design vs snapshot/restore
  fallback. (1 hour.)
- Item 4: does sonner render assertably under happy-dom? (1 hour timebox;
  fallback defined.)

**Total estimate:** roughly 3–4 focused days across the three PRs.

**Explicitly out of scope** (from the evaluation, item 10): replacing the
atom-seeded typing path. Enter-key/paste/IME behavior (e.g. the #3790
Enter-submit bug class) stays with the e2e suite by design; HYBRID_HARNESS.md
already documents the concession.
