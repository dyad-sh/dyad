# Code explorer: single utilityProcess host + byte-budgeted index cache

## Motivation

The code explorer currently runs up to `MAX_WORKER_SESSIONS = 8` persistent `worker_threads`
sessions (`src/ipc/processors/code_explorer.ts:19-29`), keyed by appPath + tsconfig, each
retaining a whole-project graph index and transiently a full `ts.Program` during (re)builds.
Because Electron builds V8 with pointer compression, all worker_thread isolates share the main
process's single ~4 GB heap cage (verified empirically on Electron 40: two workers each
OOM-abort at ~2 GB / 4 GB combined, and a worker OOM kills the entire process with a fatal
abort). A count-based session cap bounds the wrong dimension: 8 tiny-app sessions are harmless
while 2–3 large-app sessions exhaust the cage and crash Dyad. See `plans/memory-report.md`.

Fix shape: host all explorer sessions in ONE `utilityProcess` (own 4 GB cage, OOM non-fatal to
the app, one ~50–100 MB process baseline instead of up to eight, visible to diagnostics as an
ordinary child), and evict cached indexes by measured bytes instead of session count.

Key simplification: the worker (`workers/code_explorer/code_explorer_worker.ts`) already keeps
a multi-key `indexCache` Map internally — it can hold multiple project indexes; it just never
receives more than one key today because main routes each key to its own thread. The host is
mostly main-side deletion, not worker-side construction.

**Sequencing:** land the TSC-worker → utilityProcess PR first; it establishes the
utilityProcess build/packaging pattern (entrypoint emission, dev + packaged/ASAR path
resolution) that this work reuses.

## Phase 1 — Consolidate into one host process

Main side (`src/ipc/processors/code_explorer.ts`):

- Replace `workerSessions` Map, `getWorkerSession`, `pruneWorkerSessions`, and
  `MAX_WORKER_SESSIONS` with a single lazily-spawned
  `utilityProcess.fork("code_explorer_host.js", { serviceName: "dyad-code-explorer" })`.
- Add `requestId` to `CodeExplorerWorkerInput`/`Output`
  (`shared/code_explorer_types.ts`). Matching currently relies on one-in-flight-per-worker
  (`worker.once("message")`, code_explorer.ts:322); a shared host needs explicit correlation
  via a pending-requests Map.
- Preserve per-key serial-queue semantics (the `session.queue` chaining at
  code_explorer.ts:226-234) so within-app behavior is unchanged. Cross-app queries serialize
  in the host's single thread — acceptable: within-app queries already serialize today, and
  cross-app parallel exploration is rare. (Escape hatch if ever needed: the host can spawn its
  own worker_threads, which share the HOST's cage — exactly the budget.)
- Idle policy moves up a level: kill the whole host after 5 idle minutes (reuse
  `WORKER_IDLE_TIMEOUT_MS`), freeing the process baseline AND every index — strictly better
  than per-session teardown.
- Exit/crash handling: on host `exit`, reject all pending requests via the existing
  `toCodeExplorerError` path (callers already handle worker death, code_explorer.ts:306-315);
  respawn on next call. Crash-loop guard: if the host dies twice within ~1 minute while
  building the SAME key, mark that key unavailable for the session and return
  `DyadErrorKind.Precondition` ("project too large to index") instead of retrying forever.

Worker side: repurpose `code_explorer_worker.ts` as the host entry — switch worker_threads
`parentPort` to `process.parentPort` (utility-process API), serve concurrent keys from the
existing `indexCache`, echo `requestId`. Reuse the TSC PR's build/packaging pattern.

## Phase 2 — Byte budget inside the host

- Spawn with `execArgv: ["--expose-gc", "--max-old-space-size=3584"]`: expose-gc makes heap
  measurement honest (GC before measuring); the explicit ceiling below the 4 GB cage makes
  overflow fail cleanly and slightly earlier.
- Evict BEFORE building, not after. Prior to constructing a `ts.Program` for a (re)build:
  drop the stale index for that key first (never hold old index + new program simultaneously),
  run GC, read `v8.getHeapStatistics().used_heap_size`, evict LRU indexes until
  `used + estimated build headroom` fits the budget (default ~2.5 GB — leaves ~1 GB of cage
  for the transient program spike; the program is released after indexing, as today).
- Per-index cost = GC'd heap delta across the build (GC + measure pre-build and post-build).
  Imprecise but honest enough for LRU-until-under-budget, and it makes eviction a pure,
  unit-testable function: `evictionPlan(entries: {key, lastUsedAt, bytes}[], budget, incoming)`.
- Keep a small secondary count cap (~4) so many-tiny-projects cases don't accumulate
  unbounded metadata.
- Log every eviction with key + bytes so budget behavior is visible in session exports.

## Phase 3 — Observability and cleanup

- The host appears in process-memory diagnostics automatically (`app.getAppMetrics()` includes
  Utility processes; `serviceName` labels it — see PR #3860). Additionally: host replies to a
  `stats` message with `getHeapStatistics()` + per-index sizes; include in the session-export
  bundle.
- Delete dead session machinery in main (`WorkerSession`, prune/idle-timer plumbing —
  code_explorer.ts:19-29, 241-284, 329-350 collapse to a small host client).
- Availability checks (`getCodeExplorerAvailability`, tsconfig discovery) stay in main
  untouched — cheap fs probes, no process needed.

## Outcome

Worst case today: 8 worker threads × whole-project indexes + a transient `ts.Program`, all in
main's 4 GB cage, fatal on overflow. After: one child process, ≤2.5 GB of indexes + bounded
rebuild headroom in its own cage, non-fatal on overflow, one baseline instead of eight,
killable and measurable as an ordinary child.

## Risks

- The requestId protocol change is the main behavioral surface — get pending-map cleanup right
  on host death (no leaked promises, no double-settle).
- Heap-delta sizing can under-count shared structures — acceptable; enforcement is against
  measured TOTAL heap, which can't lie.
- `utilityProcess` is post-`app.ready` only — all callers are IPC handlers, so fine.
- Cross-app query serialization in the host — acceptable regression (rare path); escape hatch
  documented in Phase 1.

## PR slicing

1. Phases 1+2 together as one reviewable PR (protocol + host + budget).
2. Phase 3 as a small follow-up.
