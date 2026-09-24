# Design sketch: never run app code on the host

Status: design sketch only, no code. Date: 2026-09-24. Companion to
`macos-vm-runtime-evaluation.md`.

## Goal and threat model

"App code" means anything the app's repo or its dependencies can control:
- `package.json` scripts and dependency lifecycle scripts
- executable config files: `vite.config.*`, `playwright.config.*`, `eslint.config.*`, `postcss.config.*`, `tailwind.config.*`
- test specs
- any package in `node_modules`, **including `typescript` itself**
- git hooks, and `.git/config` keys that run commands (`core.fsmonitor`, `core.sshCommand`, `core.pager`, filter/diff drivers)

Any of these can be written by the AI, by a malicious npm package, or by an imported repo. The
goal is that none of it ever runs as the user on macOS.

## Key finding: the runtime isn't the gap, host-side tools are

On macOS, Docker containers already run inside a Linux VM, so Docker mode already keeps the
**dev server** off the host. A native VM wouldn't add a stronger boundary. The problem is that
many Dyad features run app code on the host **no matter which runtime is selected**:

| Host execution path | Where | What runs |
|---|---|---|
| Playwright bootstrap and runner | `playwright_bootstrap.ts` ~1719, `tests_handlers.ts` ~400/1191 | host `pnpm add` (lifecycle scripts), host `node` running the app's `@playwright/test`, `playwright.config.ts`, and specs |
| Sandboxed E2E dev server | `e2e_test_runtime.ts` ~678 (`shell: true`) | the app's install/start commands on the host (host runtime only) |
| `run_build` agent tool | `run_build.ts` ~359 | `npm/pnpm run build` on the host |
| `run_pre_commit` agent tool | `run_pre_commit.ts` | the repo's pre-commit hook on the host |
| Add dependency | `executeAddDependency`, `isolated_package_install.ts` | host package manager plus lifecycle scripts |
| Type checks / code explorer | `tsc.ts`, `code_explorer.ts` (`getTypeScriptCompilerPath`) | loads the **app's own** `node_modules/typescript` into a host Node process |
| Claude Code (Subscription) backend | `claude_code/runtime.ts` ~317/365 | **Not an execution path**: built-in tools are off (`--tools ""`), hooks disabled, and only Dyad MCP tools are allowed. But `cwd` = the app dir and there's no `--setting-sources`, so the app's `.claude/settings*.json` is still loaded (`env` / `apiKeyHelper`, not yet confirmed exploitable). |
| git | `git_utils.ts` ~922 disables hooks for auto-commits only | other git commands (checkout, status, push…) respect repo hooks and `.git/config` |
| Deploy builds (Cloudflare/Nitro) | `cloudflare_deploy/*`, `nitro_setup.ts` | **not audited yet** |

**Container escape that exists today in Docker mode:** `docker run -v <appPath>:/app` mounts the
whole repo **including `.git/`**. Code in the container can write `core.fsmonitor=<cmd>` into
`/app/.git/config`, and Dyad's next host `git status` then runs `<cmd>` on the Mac. A `.git/hooks/*`
file combined with a later host git command that doesn't disable hooks works the same way.

## What it would look like

### 1. One place that runs processes

Add a single `Executor` interface: `exec(argv, { cwd, env, signal, onOutput }) → { code }`, with
two implementations:
- `HostExecutor`: used only for Dyad-owned binaries (git with hardened flags, ripgrep, `node --version`).
- `GuestExecutor`: for anything that touches app code. It runs `docker exec` today, or a vsock
  agent in a future VM.

Every row in the table above goes through the Executor, and the call site picks guest or host by
**what it runs**, not by the runtime mode. Enforce this with an oxlint `no-restricted-imports`
rule on `child_process` / `utilityProcess` outside the executor module (with an explicit allowlist).

### 2. Split the filesystem

- The host owns the working tree (Dyad writes source files) and `.git`.
- The guest gets the working tree **without `.git`**: mask it with an empty tmpfs over
  `/app/.git`, or mount a copy that excludes it. `node_modules` and the pnpm store live on a
  guest-only volume (this also fixes the pnpm hardlink and virtiofs speed issues from the other doc).
- Nothing the guest writes should be *executed* by the host. The host may *read* guest output as
  data: source edits, test JSON, build logs.

### 3. Harden host git

Every host git command gets
`-c core.hooksPath=<empty> -c core.fsmonitor=false -c core.sshCommand= -c core.pager=cat
-c protocol.ext.allow=never` and `--no-verify` where it applies, set once in the git wrapper,
not at each call site. The repo's local config and hooks are treated as untrusted. (Instead, or
as well, use isomorphic-git for data-only operations.)

### 4. Move tools into the guest

| Feature | In isolated mode |
|---|---|
| Install / add dependency | `pnpm add` in the guest |
| Dev server | guest (already true for Docker) |
| `run_build`, lint | guest; the host parses the output |
| Type checks | Either run `tsc --noEmit` in the guest and parse the diagnostics, or keep the host code explorer but load **Dyad's bundled TypeScript**, never the app's. Reading `.d.ts` files is data, running `typescript/lib/tsc.js` is code. That also needs a host-readable (read-only) view of guest `node_modules`, or the explorer loses dependency types. |
| E2E tests | Playwright plus headless Chromium **in the guest image**, pointed at the guest-local dev server. "Watch in preview" is **not supported in Docker mode** (exposing Electron CDP to the guest would be a path back to the host). |
| Pre-commit hook | **Not supported in Docker mode.** Host commits always run with hooks off. |
| Claude Code / Codex subscription backends | Stay on the host: neither runs app code (Codex is direct HTTPS, and Claude Code has built-in tools off). Their tool calls are Dyad tools, which go through the Executor. Add `--setting-sources ""` to Claude Code. |

### 5. Network and secrets

- The guest gets internet egress (it needs the npm registry), but **no route to host loopback
  services**: Dyad's internal servers, e.g. `test_case_lifecycle_server`, and anything else on
  the Mac's `localhost`. Docker Desktop's `host.docker.internal` has to be blocked. A VM
  controls this more cleanly than Docker does.
- Pass only the app's own env and secrets into the guest, never Dyad's provider API keys or
  OAuth tokens.
- Publish only the preview port back to the host.

### 6. What stays out of scope

The preview itself renders untrusted web content in Electron in every mode. That boundary is the
webview's `sandbox`, `contextIsolation` and no `nodeIntegration`, and needs its own review.

## How to verify it

Build a "hostile app" fixture where every vector touches a marker file on the host
(`~/.dyad-canary-*`):
- `postinstall`, `prepare`
- `vite.config` / `playwright.config` / `eslint.config` top-level code
- a fake `node_modules/typescript/lib/typescript.js`
- a pre-commit hook
- `core.fsmonitor` written into `.git/config` from inside the guest
- a spec file
- a dependency's `install` script

An E2E test turns on isolated mode, runs the dev server, runs tests, builds, type-checks, runs
pre-commit, adds a dependency and makes a commit, then asserts **no marker exists**. Run it in
CI with Docker on Linux runners (the logic doesn't depend on the runtime). Pair it with the lint
rule from step 1 so new host `spawn` calls fail review.

## Cost and trade-offs

- **Every tool gets slower**: each call is a guest round-trip, and the guest must be running
  for any tool to work, not just the preview.
- **Guest image grows**: Node, pnpm, Chromium plus its deps, git. That's roughly 1 GB+ for the
  Playwright layer.
- **Features not supported in Docker mode (decided)**: watching tests in the preview pane, and
  pre-commit hooks. The subscription backends stay available (they run on the host but only as
  inference clients).
- **Platforms**: the same design works on Docker for Windows/Linux, so this doesn't require a
  macOS-only VM. The VM only adds control over networking/loopback and removes the Docker
  Desktop dependency.

## How the tools move into the guest

### Building blocks

1. **A long-lived workspace container per app**, e.g.
   `docker run -d --name dyad-ws-<id> … sleep infinity`, with `--init` (tini) as PID 1.
   The dev server, installs and tools all start inside it with `docker exec`. Today the
   container *is* the dev server (`run --rm`), so every restart pays container start
   and `docker build`.
   Mounts:
   - `<appPath>:/app` (read-write) with an empty tmpfs over `/app/.git`
   - `dyad-nm-<id>:/app/node_modules`, which also holds the pnpm store
   - Dyad's sandbox root (where E2E/build snapshots are created) at `/dyad-sandboxes`
   - Dyad's guest helper scripts at `/dyad/lib` (read-only)
2. **`GuestExecutor.exec(argv, { cwd, env, signal, timeoutMs, onOutput })`**. It returns the
   same `SpawnStreamingResult` shape that `spawnStreaming` returns today, so call sites
   barely change. It has to handle:
   - **Path mapping:** host `cwd` → `/app/...` on the way in. `/app/...` → host paths in output
     on the way out (tsc/eslint diagnostics, Playwright JSON, stack traces).
   - **Cancel/timeout:** killing the `docker exec` client does **not** kill the process inside
     the container. Wrap each command:
     `sh -c 'echo $$ > /run/dyad/<execId>.pid; exec setsid <cmd>'`, then on abort run
     `docker exec … kill -TERM -<pgid>`, and later `-KILL`.
   - **Env allowlist:** the app's `.env`/config and `PORT`, never Dyad's provider keys/tokens.
   - **Guest down:** start the workspace container on demand (the VM boot takes ~12s, so show
     it as "Starting runtime…").
3. **Trusted Dyad helpers that run in the guest.** Some tools are Dyad's own code that *loads*
   app code (the code explorer loads the app's `typescript`). Ship the helper as a plain Node
   script mounted read-only, run it with `node /dyad/lib/<helper>.js`, and talk JSON over stdio.
   A compromised guest can only make the helper return wrong answers. The host treats the
   answers as untrusted data and validates them against a schema.
4. **Snapshots stay on the host.** Isolated builds (`run_build`, "git-worktree-overlay") and
   sandboxed E2E (`createE2eTestWorkspace`) already create git snapshots under Dyad's sandbox
   root. Git is trusted host work and runs with hooks disabled. Only *executing inside* the
   snapshot moves: the guest sees it at `/dyad-sandboxes/<run>`. Each snapshot gets its own
   `node_modules` volume (or `/tmp` in the guest), not the live app's.

### Tool by tool

| Tool | Today | In the guest | Difficulty |
|---|---|---|---|
| Dev server | `docker run --rm` or host spawn | `exec` in the workspace container. Report "ready" only after the watcher is ready (see the race in the measurements below). | Low |
| Install / add dependency (`executeAddDependency`, `isolated_package_install.ts`) | host pnpm/npm | same argv through `GuestExecutor`. `package.json` and the lockfile come back through the bind mount. | Low |
| `run_build` (`run_build.ts` ~359) | host `pnpm run build`, in place or in a snapshot | `exec` in `/app` or `/dyad-sandboxes/<run>` | Low |
| Type checks (`tsc.ts`) | spawns the app's `tsc` with `--incremental --tsBuildInfoFile <host cache>` | same CLI through `exec`. Keep the buildinfo in the guest (e.g. `/app/node_modules/.cache/dyad-tsc`) and map diagnostic paths back. | Low–medium |
| Code explorer (`code_explorer.ts` ~413, `utilityProcess.fork`) | worker loads the app's TS compiler on the host | the same worker as a guest helper over a stdio JSON protocol instead of a utilityProcess MessagePort | Medium |
| Lint | host | `exec` | Low |
| Playwright bootstrap and run (`playwright_bootstrap.ts`, `tests_handlers.ts`) | host `pnpm add`, host `node cli.js`, host Chromium | `pnpm add` and `node …/cli.js` in the guest. Chromium is baked into the image (Playwright's Ubuntu base, not Alpine). Results JSON is written to the snapshot and read by the host as data. | Medium |
| Test-case lifecycle bridge (`test_case_lifecycle_server.ts`) | host HTTP server on loopback, token in env | Keep it on the host (it holds the DB/admin credentials, which is correct). Expose **only this port** to the guest (e.g. `host.docker.internal:<port>` plus a firewall rule allowing just that port), with the existing per-run token. | Medium |
| Watching tests in the preview pane (preview CDP endpoint) | Playwright connects to Electron over CDP | **Not supported in Docker mode (decided).** Tests run headless in the guest, and the UI hides the option. | — |
| Sandboxed E2E dev server (`e2e_test_runtime.ts` ~678) | host `spawn(..., {shell:true})` in the snapshot | `exec` in `/dyad-sandboxes/<run>` on a run-scoped port that's published or reached inside the guest | Medium |
| Pre-commit (`run_pre_commit.ts`) | hook runs on the host against the real `.git` | **Not supported in Docker mode (decided).** Don't offer the agent tool. Host commits keep hooks off. | — |
| Claude Code / Codex subscription backends | Codex: direct HTTPS to `chatgpt.com/backend-api/codex/responses`, no CLI. Claude Code: CLI as an inference-only client, tools off. | **Stay on the host.** Their tool calls are Dyad tools, which route through the Executor. Harden Claude Code with `--setting-sources ""` (in every mode) so the app repo's `.claude/settings*.json` isn't loaded. | Low |
| grep / read_file / list_files | host ripgrep and fs | stay on the host: Dyad's own binaries only *reading* files | — |
| Deploy builds (Cloudflare/Nitro) | not audited | probably `exec` | Audit |

### Guest image

A Dyad-owned image, versioned with each Dyad release (e.g. `ghcr.io/dyad-sh/runtime:<ver>`).
It contains Node 22 LTS, pnpm (pinned), git, and a Playwright-matched Chromium plus its system
libs. It's pulled the first time isolated mode is turned on (~1–1.5 GB with Chromium), and the
Chromium layer could be split out and pulled only when tests are first used. This replaces the
per-app `Dockerfile.dyad` that's written into user repos today.

### Migration path

1. Add `Executor` with `HostExecutor` = today's `spawnStreaming`. This refactor doesn't change
   behavior in host mode.
2. Add the workspace container and `GuestExecutor`, and move the dev server and install over
   first. That alone is the `vol` layout, and it improves Docker mode speed.
3. Then build, tsc, lint and add dependency (all argv-only swaps).
4. Then the code explorer helper, Playwright, E2E sandbox and the lifecycle-bridge port.
5. Hide preview-pane test watching and `run_pre_commit` in Docker mode. Add `--setting-sources ""` to the Claude Code launch (in every mode).
6. Add the lint rule blocking `child_process` outside the executor, then the hostile-app canary E2E.

## Measured cost (2026-09-24)

Setup: Mac mini M4 (10 cores, 16 GB). Colima 0.10.1 with `--vm-type vz --mount-type virtiofs`
(the same hypervisor and file sharing as Docker Desktop), 6 vCPU / 8 GB. App: the Dyad
`scaffold/` (Vite 8, React, shadcn, ~34k files in `node_modules`). pnpm 11.22.0 on both sides.
Script: `devbench.mjs` in the session scratchpad; the page is loaded with Playwright Chromium on the host.
Layouts compared:
- **host**: everything runs natively on the Mac.
- **bind**: today's Docker mode. The app folder is mounted from the Mac, so `node_modules` is
  written to the Mac through virtiofs, and the pnpm store is on a separate volume.
- **vol**: the proposed layout. Source is still mounted from the Mac, but `node_modules` and
  the pnpm store share one volume on the VM's disk.

| Operation | host | bind (today) | vol (proposed) |
|---|---|---|---|
| `pnpm install`, cold store (incl. downloads) | 4.8s | 11.6s | 4.9s |
| `pnpm install`, warm store | 2.8–3.0s | 9.0–9.3s | 3.3–3.7s |
| Dev server: start → HTTP 200 | 0.56–0.62s | 0.71–1.22s | 0.67–0.87s |
| First page load (fresh browser) | 92–158ms | 169–817ms | 113–260ms |
| Reload | 34ms | 35ms | 35ms |
| HMR, edit → text visible (median) | 188ms | 285ms | 285ms |
| `tsc --noEmit` (via `docker exec`) | 1.35–1.93s | 2.44–2.72s | 2.05–2.22s |
| `vite build` | 0.62–1.12s | 1.17–1.27s | 0.83–0.87s |
| `eslint .` | 0.64–1.30s | 1.28–1.55s | 0.85–1.00s |
| `docker exec` fixed cost per call | – | ~29ms | ~29ms |
| VM boot: first create / restart | – | 24s / 12s | 24s / 12s |

Takeaways:
- **Today's Docker mode costs about 3x on installs** because of the virtiofs `node_modules` and the
  pnpm copy fallback. The proposed layout is within about 10–20% of the Mac.
- **Tools run from the guest are +0–0.7s each** (tsc was the worst at about +0.6s). Build and
  lint in `vol` were sometimes *faster* than on the Mac, which is noise at this size. The ~29ms
  exec cost doesn't matter.
- **HMR adds about 100ms** (185 → 285ms) in both container layouts. The fsevents→inotify bridge is the
  cost, so moving `node_modules` doesn't change it.
- **Watcher startup race:** in `vol`, the first edit made about 1s after the server answered was
  **never seen by Vite** in 5 of 8 runs (no "hmr update" in the log). With a 3s settle
  delay, all 5 runs worked. In `bind`, the first edit took 0.8–3.8s. Chokidar is still scanning
  the virtiofs source tree after Vite reports ready. Dyad would need to wait for the watcher to be
  ready, or poll, before treating the preview as live.
- **The biggest user-visible cost is VM boot**: about 12s from stopped, or 24s on first create.
  That's a one-time cost per session if the VM stays running.
- **Not measured**: Playwright in the guest (needs a Chromium image of about 1–2 GB). Browser work
  is CPU-bound, so I'd expect it to be close to the Mac; the unknown is the extra setup. Also not
  measured: a large app (more modules makes the first page load gap bigger), and Docker Desktop
  itself (same hypervisor; its file-sharing layer is tuned differently).

## Suggested order

1. **Now, in every mode:** harden host git (step 3), and stop mounting `.git` into the Docker
   container. This closes the existing escape and is cheap.
2. Load Dyad's bundled TypeScript instead of the app's for the code explorer and `tsc` in every
   mode, if that's feasible. **Needs checking:** version-skew effects on user projects.
3. Add the Executor abstraction and lint rule. Move install, build, lint, tests and pre-commit
   behind it.
4. Add an "Isolated" runtime setting (Docker-backed first) that routes everything to the guest,
   then add the canary E2E.
5. Revisit a native VM only for network isolation or removing the Docker Desktop dependency.
