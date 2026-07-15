# Electron Workers and Main-Process Memory

Read this when spawning `worker_threads` or `utilityProcess` children, moving heavy computation off the main process, or diagnosing main-process memory usage and OOM crashes.

## The shared 4 GB V8 heap cage

- Electron builds V8 with pointer compression (the "memory cage", enabled since Electron 21), which caps the V8 heap at ~4 GB — and the cap is effectively **process-wide**: all isolates in a process, meaning the main isolate plus every `worker_threads` worker, share one cage. Verified empirically on Electron 40: `v8.getHeapStatistics().heap_size_limit` reports 4 GB _per isolate_, yet two worker_threads each OOM-abort at ~2 GB (~4 GB combined).
- A worker_thread that exhausts the heap does **not** fail gracefully: V8 fatal-aborts the **entire process** (`FATAL ERROR: Reached heap limit` → SIGABRT / `EXC_BREAKPOINT` in Electron Framework). Main-process native crashes on very large user apps have this signature.
- `--max-old-space-size` cannot raise the cap, whether passed via js-flags, `NODE_OPTIONS`, or `execArgv`.
- Consequence: memory-heavy workloads (full `ts.createIncrementalProgram` builds, whole-project indexes) belong in a `utilityProcess`, which gets its **own** cage and whose OOM surfaces as a child `exit` event instead of an app crash. Keep `worker_threads` for small, bounded work — and set `resourceLimits` (`maxOldGenerationSizeMb`): exceeding it terminates only that worker with `ERR_WORKER_OUT_OF_MEMORY` rather than aborting the process.
- References: [Electron and the V8 Memory Cage](https://www.electronjs.org/blog/v8-memory-cage), [nodejs/node#55735 (pointer compression forces a process-wide 4 GB limit; isolate groups)](https://github.com/nodejs/node/issues/55735).

## utilityProcess conversion checklist

- `ELECTRON_RUN_AS_NODE` fork is **not** available in this app: the `RunAsNode` fuse is disabled in `forge.config.ts`. Use `utilityProcess.fork` (available only after app ready).
- No build-config changes are needed for worker entrypoints: the forge VitePlugin already emits worker files (e.g. `tsc_worker.js`, `code_explorer_worker.js`) next to `main.js`, and `path.join(__dirname, "<worker>.js")` resolves both in dev and inside `app.asar`.
- Worker side: use `process.parentPort`; messages arrive as a `MessageEvent` — read `event.data`, not the raw argument. The `workers/` tsconfig has no Electron typings; declare a minimal local `UtilityProcessParentPort` interface instead of importing `electron`.
- Send only after `spawn`: calling `child.postMessage()` before the `spawn` event relies on undocumented buffering. Construct the input and post it inside `child.on("spawn", ...)`.
- Settle-once discipline: exactly one of message/error/exit/timeout may settle a request. Reject on **any** pre-reply exit, including exit code 0 (a clean early exit otherwise hangs the caller forever). Always `child.kill()` on every settle path, and add a hard timeout.
- When different utility workloads must never coexist, serializing requests is not enough if one workload keeps an idle process/cache alive. Track the resident process separately, mark it stopping as soon as eviction begins, and await its actual `exit` before forking the next workload; tests must model the `kill()` → `exit` gap.
- Put a deadline on resident shutdown so a missing `exit` cannot hold the scheduler forever, but do **not** clear the resident or launch another process on timeout. Reject that queued operation, reset the cached stop attempt, and mark the resident non-reusable — its owner has already detached its handle — so every later operation (same-kind included) retries the stop instead of reusing it; a real exit then clears the registration without weakening mutual exclusion.
- The UtilityProcess `error` event is experimental in Electron 40; handle it defensively and treat `type === "FatalError"` as probable OOM — map it to a user-facing message ("ran out of memory ... very large apps") instead of surfacing a raw V8 error.
- Electron 40's `utilityProcess.fork` delivers `execArgv` to `process.execArgv` but does **not apply V8 flags from it**: `--expose-gc` and `--max-old-space-size` are no-ops, and `NODE_OPTIONS` via `env` is ignored too. To get `gc()` inside the child, acquire it at runtime — `v8.setFlagsFromString("--expose-gc")` then `vm.runInNewContext("gc")` — and degrade gracefully (measure without forced GC) if that ever stops working.
- Give children a `serviceName` so they are identifiable in `app.getAppMetrics()` and Activity Monitor.
- Unit-test the child lifecycle with a file-scoped `vi.mock("electron")` whose `utilityProcess.fork` returns an EventEmitter-backed fake child (emit spawn/message/error/exit; spy on postMessage/kill). The shared inert mock in `src/testing/electron_mock.ts` cannot emit events, and the AGENTS.md test mandate applies: cover the timeout, pre-reply-exit, fatal-error, and settle-once paths, not just the happy path.

## Measuring memory honestly

- Logged main-process RSS **includes** all worker_threads — they are threads, not processes. Renderer/GPU/utility processes are separate; enumerate them with `app.getAppMetrics()`.
- On macOS, `os.totalmem() - os.freemem()` is misleading: `os.freemem()` counts only truly-free pages, so reclaimable file cache reads as "used" (a healthy 16 GB Mac can show ~85% "used" by this formula while `memory_pressure` reports the system 86% free). For real pressure signals use `vm_stat` (pageouts, compressed pages), `sysctl vm.swapusage`, and `memory_pressure`.
- Two V8 string facts that change memory math: ASCII text is stored at 1 byte/char (not 2), and string concatenation builds lazy cons strings — a `` `${prefix} ${hugeString}` `` template is nearly free until something flattens it (e.g. `JSON.stringify`). Corollary: never re-materialize codebase-scale strings just to measure them — sum `content.length` values instead of `join(...)` followed by `.length`.

## Development launcher cleanup

- Treat Ctrl+C cleanup for `npm start` as development tooling; do not add signal-only shutdown behavior to packaged runtime paths. A POSIX supervisor should launch Electron Forge as a process-group leader and signal the negative group PID so Forge, Electron, renderer helpers, and preview servers are terminated together.
- Keep SIGINT/SIGTERM/SIGHUP handlers installed until forced cleanup finishes. npm and the controlling PTY can deliver repeated signals; a one-shot handler lets a later signal terminate the supervisor before its fallback timer kills children that ignored SIGTERM.
- Electron's macOS Crashpad handler leaves the Forge process group, and a killed Electron process can remain registered with LaunchServices. Clean up the checkout-specific Crashpad PID separately and notify `lsappinfo` of the Electron PID's exit so no helper or Dock entry remains.
