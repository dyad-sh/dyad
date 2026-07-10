# Memory investigation: crashes on very large apps (16 GB macOS)

**Context:** A user on Dyad 1.6.2 (macOS arm64, 16 GB RAM) reported repeated native crashes
(`EXC_BREAKPOINT` in Electron Framework) while working on an unusually large React/Vite app:
~8,200 files, ~55M extracted codebase characters (~13.8M estimated tokens), 300+ Supabase Edge
Functions. Dyad main-process RSS climbed from ~850 MB to ~3.0–3.4 GB before crashes; system
memory was pinned near 16.1–16.3 / 16.4 GB. Crashes occurred both with and without Supabase
deploys.

This report audits the code paths named in the incident report, scores each of its hypotheses
against the actual source, includes an empirical measurement of the string-duplication pattern,
and ranks concrete fixes.

---

## Headline finding

The incident report's conclusion (memory exhaustion on very large apps) is correct, but its
mechanism is substantially wrong — and it makes one factual error that inverts the diagnosis.

It lists "TSC worker processes" as _excluded_ from Dyad's logged main-process RSS. They are not.
Both the TSC worker and the code-explorer workers are `node:worker_threads`:

- `src/ipc/processors/tsc.ts:155` — `new Worker(workerPath)` (no `resourceLimits`, no heap flags)
- `src/ipc/processors/code_explorer.ts:250` — same, pooled up to 8 sessions

Worker threads run **inside the main process**; their heaps _are_ the logged main RSS. A full
`ts.createIncrementalProgram` over an 8,200-file app (`workers/tsc/tsc_worker.ts:168-184`), plus
up to 8 resident code-explorer sessions each retaining a whole-project graph index
(`src/ipc/processors/code_explorer.ts:19-29`, `workers/code_explorer/core/indexer.ts:47-74`), is
exactly the kind of workload that takes a main process from ~850 MB to ~3 GB. The crash session
explicitly involved "TSC worker activity." An `EXC_BREAKPOINT` in Electron Framework is
consistent with a V8 fatal OOM abort when a worker or the main isolate exhausts its heap.

Codebase-string churn is a real secondary contributor (measured below at ~270 MB heap per chat
turn at this app's scale), and lingering Vite preview processes explain the _system-wide_
pressure — but the worker threads are the most plausible driver of the 3 GB main RSS.

---

## Measurement

Simulated the exact allocation pattern of `extractCodebase` → chat-stream (non-engine) at the
reported scale — 8,200 files, 55M chars of ASCII source — on Node with `--expose-gc`, snapshotting
heap after each stage that mirrors a real code path:

| Stage (mirrors)                                                        | heapUsed | Δ                                     |
| ---------------------------------------------------------------------- | -------- | ------------------------------------- |
| baseline                                                               | 4 MB     | —                                     |
| per-file content strings (`readFileWithCache`, codebase.ts:207-257)    | 57 MB    | +53 MB                                |
| `filesArray` of `{path, content}` refs (codebase.ts:660-671)           | 58 MB    | ~0 (refs only)                        |
| `formattedOutput` wrap + join (codebase.ts:431-473, 679)               | 110 MB   | +52 MB                                |
| `createCodebasePrompt` template wrap (chat_stream_handlers.ts:2222)    | 110 MB   | **~0 — lazy cons string**             |
| JSON request-body serialization (AI SDK send)                          | 217 MB   | +107 MB (flattens cons string + body) |
| smart-files count re-materialization (token_count_handlers.ts:133-140) | 270 MB   | +53 MB                                |

Three corrections to the incident report's assumptions fall out of this:

1. **Source code is ASCII, so V8 stores it at 1 byte/char.** One full codebase copy is ~55 MB,
   not the ~110 MB the 2-bytes/char worst case suggests.
2. **The `createCodebasePrompt` "copy" is nearly free** until flattened — V8 represents the
   template-literal concat as a lazy cons string. The cost lands later, at JSON serialization.
3. **A full streaming turn peaks around ~270 MB of heap** — significant churn (and it repeats on
   every debounced token count, every stream, every auto-fix retry), but it does not add up to
   3 GB on its own.

---

## Scorecard: incident-report claims vs. actual code

| Claim                                                              | Verdict                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token counting over huge context is a memory risk                  | **Refuted**                      | No tokenizer exists in the codebase (no tiktoken/gpt-tokenizer in package.json). `estimateTokens` is `Math.ceil(text.length / 4)` — `src/ipc/utils/token_utils.ts:8-10`. O(1) memory; no 13.8M-element token array is ever allocated.                                                                                                                                                                |
| Proposal generation retains codebase snapshots                     | **Refuted**                      | `codebaseTokenCache` (`src/ipc/handlers/proposal_handlers.ts:55`) stores only integers + the latest assistant message string, 5-min TTL. However `get-proposal` _does_ re-extract the entire codebase to compute that one integer (`proposal_handlers.ts:77-123`).                                                                                                                                   |
| Caches hold extracted codebase/token data                          | **Partial — wrong failure mode** | `fileContentCache` (`src/utils/codebase.ts:128`) is a 500-entry FIFO (`MAX_FILE_CACHE_SIZE`, codebase.ts:119). At 8,200 files it is a ~100%-miss churn machine — every extraction re-reads all files from disk and the cache contributes nothing. For apps ≤500 files it pins the entire codebase in memory indefinitely. Mis-sized in both directions; count-based when it should be byte-budgeted. |
| Supabase upload buffers + concurrency 8 drive memory               | **Mostly refuted**               | Bundling is server-side (raw files uploaded via multipart FormData; no esbuild/eszip locally — `supabase_management_client.ts:840-882`). Only ~8 functions' buffers are live at once (`supabase_deploy_queue.ts:1`, `supabase_utils.ts:684-711`); they are GC'd after each upload. Accumulated results are metadata-only.                                                                            |
| `node:` imports break shared-module analysis → deploy-all fallback | **Confirmed exactly**            | `isClearlyExternalSpecifier` (`src/supabase_admin/supabase_utils.ts:214-222`) only recognizes `npm:`/`jsr:`/`http(s)`/`@supabase/`. Any `node:*` import hits `unknown_bare_specifier` (`supabase_utils.ts:383-385`) → `{kind:"all"}` → `deployAllSupabaseFunctions` (`supabase_utils.ts:562-567`). One builtin import redeploys all 339 functions.                                                   |
| 413 Payload Too Large on one large function                        | **Confirmed, no guard**          | No payload-size pre-check or logging anywhere in the deploy path. Only HTTP 429 is retried (`retryWithRateLimit.ts:107-110`); a 413 is discovered only after fully transmitting the oversized payload.                                                                                                                                                                                               |
| Orphaned child processes after crashes                             | **Partial**                      | No startup orphan sweep exists; cleanup is port-based and only runs when that specific app is re-run (`app_handlers.ts:695`). Separately, switching apps never stops the previous preview — old Vite dev servers linger 10 minutes (`process_manager.ts:213-305`) or **forever** with `previewIdleTimeoutPolicy: "never"` (`process_manager.ts:248-250`).                                            |
| Child-process stdout accumulation leaks                            | **Refuted**                      | All output buffers are bounded: 64 KB preview tail (`app_runtime_service.ts:689-796`), 256 KB in `spawn_streaming.ts:14-28`, 16 KB cloud-sandbox tail, 1000-entry log store (`log_store.ts:12-27`).                                                                                                                                                                                                  |
| Dyad logs only main RSS, missing TSC workers                       | **Half right — the wrong half**  | Only `process.memoryUsage().rss` is sampled (`src/utils/performance_monitor.ts:20-24`); no `app.getAppMetrics()` / `getProcessMemoryInfo` anywhere, so renderer/GPU/preview/child memory is invisible. But worker_threads **are** in that RSS — which is why the logged number reached 3 GB.                                                                                                         |

**Missed by the incident report entirely:** a 13.8M-token codebase cannot fit any model's context
window. Dyad assembles the full formatted string anyway — on every debounced `chat:count-tokens`
call (~1/sec while typing; `src/hooks/useCountTokens.ts:23-25`), every stream start
(`chat_stream_handlers.ts:783`), up to 2 auto-fix re-extractions per response
(`chat_stream_handlers.ts:1740-1779`), and every `get-proposal`. Past a few hundred KB, all of
that work produces provably unusable output.

---

## Where the memory actually goes (revised model)

| Consumer                                                                                                                     | Lives in                          | Scale at 8,200 files / 55M chars                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TSC worker: full TS program per `run_type_checks` call                                                                       | **main process** (worker thread)  | Potentially GBs; rebuilt per call; no heap cap. Note: the tool's `paths` arg does NOT narrow the check — it type-checks the whole program and filters results after (`run_type_checks.ts:104-146`). |
| Code-explorer pool: up to 8 sessions, each a whole-project graph index + transient full `ts.Program` during rebuild          | **main process** (worker threads) | Hundreds of MB–GBs; 5-min idle eviction, LRU at 9th session; no heap cap                                                                                                                            |
| Codebase string churn per turn (extraction ×2 representations + serialization)                                               | main process                      | ~270 MB peak measured; repeats ~1/sec while typing (count-tokens)                                                                                                                                   |
| `fileContentCache`                                                                                                           | main process                      | ~0 useful at 8,200 files (churns); pins whole codebase for small apps                                                                                                                               |
| Vite preview dev server(s)                                                                                                   | separate processes                | 1–2 GB+ each; linger ≥10 min after app switch; invisible to diagnostics                                                                                                                             |
| Supabase deploy FormData (≤8 in flight, each embedding a full `_shared` copy — `supabase_management_client.ts:809, 842-862`) | main process                      | Transient; bounded by 8 × (function + `_shared`) size                                                                                                                                               |

---

## Ranked recommendations

### The 4 GB shared V8 cage — measured on Electron 40 (what Dyad ships)

Electron builds V8 with pointer compression (since Electron 14; memory cage since 21), which
caps the V8 heap at 4 GB ([Electron blog](https://www.electronjs.org/blog/v8-memory-cage)) —
and the cap is **process-wide across all isolates**, not per-isolate
([nodejs/node#55735](https://github.com/nodejs/node/issues/55735)). `--max-old-space-size`
cannot raise it ([electron#41248](https://github.com/electron/electron/issues/41248),
[electron#31330](https://github.com/electron/electron/issues/31330)). Verified empirically on
Electron 40.0.0 via `ELECTRON_RUN_AS_NODE` worker_threads allocation tests:

- A single worker isolate reports `heap_size_limit = 4.00 GB` and OOM-aborts at 4001.9 MB
  (`FATAL ERROR: Reached heap limit`).
- Two worker isolates each abort at ~2,018 MB — **~4.03 GB combined** — proving one shared
  cage: each isolate claims a 4 GB limit but they exhaust a single pool.
- In both cases the **entire process dies** (SIGABRT through `node::worker::Worker::Run` in
  Electron Framework); a worker's OOM is fatal to the whole app.

Implication: Dyad's main isolate + TSC worker + up to 8 code-explorer workers share ~4 GB of
total V8 heap. The observed crash pattern (main RSS 2.8–3.4 GB, then a deliberate-abort native
crash in Electron Framework during TSC activity) is exactly what shared-cage exhaustion looks
like. This also means worker `resourceLimits` alone is insufficient (the sum still competes for
one cage) — moving TS workers to `utilityProcess` gives them their own cage and makes their OOM
non-fatal.

### Tier 1 — most likely to stop these crashes (workers)

1. **Bound and isolate the TypeScript workers.** Add `resourceLimits: { maxOldGenerationSizeMb }`
   to both `tsc.ts:155` and `code_explorer.ts:250` so a huge app degrades to a failed check
   instead of a native main-process crash. Better: move them to Electron `utilityProcess`
   (currently unused in the repo) so their memory leaves the main process entirely and dies with
   the task.
2. **Cap code-explorer residency by size, not session count.** `MAX_WORKER_SESSIONS = 8`
   (`code_explorer.ts:22`) can hold 8 whole-project indexes. For one giant app this should be 1
   session with aggressive eviction; ideally track per-session bytes and evict by budget.
3. **Scope TSC checks.** Make `run_type_checks`' `paths` argument narrow the actual program
   (project-reference or file-list based) instead of filtering diagnostics post-hoc.

### Tier 2 — codebase-string churn

4. **Add a total-size budget to `extractCodebase`** (`codebase.ts:495`). A 1 MB per-file cap
   exists (`MAX_FILE_SIZE`, codebase.ts:116) but no aggregate cap. Past ~2× the model's context
   window, bail into an explicit "codebase too large — smart context required" path instead of
   materializing two full 55 MB representations.
5. **Stop re-materializing strings just to measure them.** The smart-files token count
   (`token_count_handlers.ts:133-140`) rebuilds the entire codebase as a fresh string to call
   `.length` — a measured ~53 MB allocation per debounced call. One-line fix: sum
   `file.content.length` (+ wrapper overhead) in a reduce. Same for `get-proposal`'s
   `getCodebaseTokenCount` — cache the count keyed on a cheap mtime/size signature instead of
   re-extracting.
6. **Return one representation, not two.** `extractCodebase` returns both `formattedOutput`
   (join of everything, codebase.ts:679) and `files` (same content again, codebase.ts:660-671);
   every call site uses one or the other. Build the formatted string lazily from `files`.
7. **Make `fileContentCache` a byte-budgeted LRU** (e.g., ~50 MB) instead of a 500-entry FIFO.

### Tier 3 — Supabase (real, but an amplifier, not the root cause)

8. **Treat `node:` as external** in `isClearlyExternalSpecifier`
   (`supabase_utils.ts:214-222`) — a one-line prefix check that prevents entire 339-function
   redeploys triggered by a single builtin import. Highest ROI line of code in this report.
9. **Pre-check and log payload size per function** before upload; fail fast with a clear error
   instead of discovering 413 after transmitting the oversized setup function.
10. **Adaptive deploy concurrency.** Up to 8 in-flight FormData bodies each hold a fresh byte
    copy of the full `_shared` folder (`supabase_management_client.ts:809`, `:842-862`). Drop
    concurrency to 2–4 when per-function payloads are large; unconditionally lowering it is not
    justified — buffers are transient.

### Tier 4 — process hygiene and diagnostics

11. **Stop previews on app switch** (or shorten the 10-min idle GC), and add a startup orphan
    sweep: persist spawned child PIDs and tree-kill stale ones on boot. Addresses the "system
    memory already at 16 GB before deploy" observation.
12. **Fix diagnostics before further optimization.** Replace the RSS-only monitor
    (`performance_monitor.ts:20-24`) with `app.getAppMetrics()` (renderer/GPU/utility), child
    process-tree RSS for previews, and per-worker heap stats reported from inside each worker
    via `process.memoryUsage()` messages. Attach these to crash telemetry (`main.ts:678`).
    Today Dyad cannot see where its own memory goes, which is why the incident report had to
    guess — and guessed wrong on the biggest item.

---

## The "16.1 / 16.4 GB system memory" reading is mostly a metric artifact

Dyad computes system memory as `os.totalmem() - os.freemem()`
(`performance_monitor.ts:71-73`). On macOS, `os.freemem()` counts only truly-free pages;
inactive/speculative/purgeable pages (file cache the OS reclaims instantly under pressure) all
count as "used." Measured on a healthy 16 GB dev Mac: Dyad's formula reports **13.5 GB used
(84.7%)** at the same moment `memory_pressure` reports the system **86% free**, with ~5.8 GB of
the "used" figure being reclaimable cache (`vm_stat`: inactive 5.4 GB + speculative 0.3 GB +
purgeable 0.1 GB). Reading 8,200 files + node_modules repeatedly makes the file cache — and
therefore this number — balloon further. So the reported 16.1/16.4 GB cannot distinguish a
machine in genuine memory trouble from a healthy one, and a meaningful share of the user's
"other 13 GB" is likely reclaimable cache plus unrelated apps, not Dyad-spawned processes.

Two implications:

1. **The crash cause lives inside the 3.4 GB main process, not the 13 GB.** macOS does not
   OOM-kill desktop apps for system-wide memory exhaustion — it compresses and swaps.
   `EXC_BREAKPOINT` in Electron Framework is an in-process V8 abort (heap-limit OOM in main or
   a worker thread). System-wide pressure makes the machine slow; it does not raise that
   exception.
2. **The right system-side signals are pressure, compression, and swap** — `memory_pressure`
   level, `vm_stat` pageouts/compressed pages, `sysctl vm.swapusage` — not total-minus-free.

## External memory: what Dyad launches/manages outside its own process

Most of the 16 GB pressure is not Dyad's main process — it is process trees Dyad spawns and
manages. Ranked for the reported app shape:

1. **The live Vite dev server process tree (1–3 GB for an app this size).**
   `spawn(command, { shell: true })` at `app_runtime_service.ts:472` runs
   `pnpm install && pnpm run dev --port N` (npm variant at `:174`). Descendants: package
   manager → node/Vite (module graph + transformed-module cache for every imported module) →
   Vite's persistent esbuild service child. Lifecycle is better-bounded than it first appears:
   - Switched-away apps are idle-GC'd after ~10–11 min (`IDLE_TIMEOUT_MS` = 10 min, 60 s check
     loop, `process_manager.ts:213-215`); the timer starts on switch-away (`:227-229`). Only
     the currently-selected app is exempt, and only the opt-in
     `previewIdleTimeoutPolicy: "never"` disables GC (default is `"default"`,
     `settings.ts:75`). So overlap from multi-app use is a ~10-min transient, not steady-state.
   - Force-close orphans mostly self-heal: `getAppPort` is deterministic
     (`shared/ports.ts:29-36`) and `runApp`/`restartApp` call `cleanUpPort(getAppPort(appId))`
     before spawning (`app_handlers.ts:695`, `:922`), which kill-ports the stale listener;
     killing the Vite listener collapses the rest of its tree. Residual gaps only: apps never
     re-run after a crash, and a crash during the chained `install` phase (nothing listening on
     the port yet).
     For the reported single-app workload, the cost is one live tree — large, unbounded, and
     invisible to diagnostics — not stacking.
2. **The preview iframe — Chromium renderer memory inside Electron's own tree.** The user's
   React app executes in Dyad's renderer/helper processes via `<iframe>`
   (`PreviewIframe.tsx:271`). Dev-mode React at this scale: ~0.5–2 GB, invisible to the
   RSS-only monitor.
3. **Package-manager installs on every start/restart.** Install is unconditionally chained
   before dev (`app_runtime_service.ts:97-119, 172-178`) with no lockfile freshness check;
   even a no-op resolve on a giant lockfile transiently peaks hundreds of MB–1.5 GB, exactly at
   app-startup pressure.
4. **Whatever the app's own `dev` script runs.** Custom install/start commands run verbatim
   (`app_runtime_service.ts:206-212`); big apps often chain `tsc --watch`/codegen watchers —
   another 1–3 GB Dyad started but cannot see.
5. **Playwright E2E (conditional).** `playwright_bootstrap.ts:403,454` installs
   @playwright/test + Chromium; test runs spawn a runner + headless Chromium (~300–800 MB per
   context).
6. **Docker runtime mode (conditional).** On macOS implies the Docker Desktop VM (2–8 GB
   reserved) plus the containerized pnpm/Vite chain.
7. **Negligible:** ripgrep (`grep.ts:207`), docker CLI calls, `node --version` probes. Git is
   isomorphic-git in-process (a main-process cost, not external).

**External-tier fixes, ranked by impact:**

1. Measure the tree: walk each tracked child's descendants (`ps -o pid,ppid,rss`) and log
   per-app tree RSS alongside `app.getAppMetrics()`; enables budgets/warnings per app and
   makes items 1–4 above diagnosable instead of invisible.
2. Skip the install step when lockfile + node_modules are unchanged (hash check) — removes the
   recurring restart spike.
3. Optional `NODE_OPTIONS=--max-old-space-size` on spawned dev servers (as a setting) so a
   runaway Vite fails visibly instead of consuming the machine.
4. Marginal hardening (existing bounds already cover the common cases): shorten idle GC or
   stop-on-switch for multi-app users; boot-time sweep of the deterministic app-port range for
   orphans of apps never re-run after a crash.

---

## Suggested validation

Build the synthetic 8,000-file fixture the incident report proposes and instrument the workers
first. Prediction to test: TSC/code-explorer worker heap dominates main RSS, extraction churn is
second, Supabase deploy a distant third. Quick wins #8 (`node:` external) and #5 (token-count
one-liners) are trivial, independently testable, and could ship immediately.
