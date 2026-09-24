# Evaluation: native macOS VM runtime vs. Docker runtime

Status: evaluation only, no code. Date: 2026-09-23.

## Question

Would a runtime that runs apps in a VM using macOS's own virtualization be faster than the
current `docker` runtime mode (`runtimeMode2: "docker"`)?

## Short answer

**Not by itself.** On Apple silicon, Docker Desktop, OrbStack, Colima (vz) and Apple's
`container` CLI all use the same `Virtualization.framework` hypervisor. Docker Desktop and
OrbStack also share files with virtiofs, the same way a VM Dyad built itself would. The
per-operation costs are about the same, so a Dyad-owned VM would only be faster where we
change _where files live_ and _how often work is repeated_. We can make those changes in the
existing Docker mode for much less effort. Neither would beat `host` mode, which stays the
fastest.

A Dyad-owned VM's real benefits aren't speed: no Docker Desktop install, no Docker Desktop
licensing for larger companies, and a lower idle memory cost. Those might justify it later,
but the complexity is large (see below).

## How Docker mode works today

`executeAppInDocker` in `src/ipc/services/app_runtime_service.ts` (about lines 946–1188):

1. `docker --version` check, then `docker stop` / `docker rm` of `dyad-app-<id>`.
2. If it doesn't exist, writes `Dockerfile.dyad` into the **user's app dir** (`FROM node:22-alpine` +
   `npm install -g pnpm`), then runs `docker build -t dyad-app-<id> .` **on every start**, one
   image per app.
3. `docker run --rm -p port:port -v <appPath>:/app -v dyad-pnpm-<id>:/app/.pnpm-store` running
   `pnpm install && pnpm rebuild … && pnpm dev --port`.

Other code that checks the Docker mode: `process_manager.ts` (stop/volume removal),
`cleanUpPort`, `run_build.ts` (forces the isolated path), `e2eSandbox.ts` /
`isolated_test_db.ts` / `tests_handlers.ts` (sandboxed E2E and Neon isolation are
**host-only**), `PreviewErrorBanner`, telemetry and issue-body reporting. The UI labels it
"Docker (experimental)".

## Where Docker mode's time actually goes (hypotheses, not yet measured)

| Cost                                                | Why                                                                                                                                                                                                                                        | Would a native VM fix it?                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `node_modules` written to the host through virtiofs | `/app` is a bind mount, so every one of ~10–50k files `pnpm install` creates goes through the VM↔host file-sharing layer. Vite then resolves and stats modules over the same path. This is usually the biggest slowdown for Node on macOS. | Only if the VM keeps `node_modules` on its own disk, and Docker can do that too with a named volume. |
| pnpm store can't hardlink                           | The store is a separate volume (`/app/.pnpm-store`) from `/app` (bind mount). They're different filesystems, so pnpm has to **copy** every package on every clean install.                                                                 | Same fix is available in Docker (put the store and `node_modules` on the same volume).               |
| `docker build` every start plus one image per app   | Cheap once cached, but it adds a daemon round-trip on each start. The Dockerfile is also written into the user's repo.                                                                                                                     | Use one shared, pre-built runtime image instead. That's a Docker-side fix.                           |
| Docker Desktop cold start / idle RAM                | The daemon VM has to be running, and it reserves GBs of memory.                                                                                                                                                                            | **Yes.** This is where a per-app lightweight VM (Apple `container`) or a Dyad-managed VM helps.      |
| Port forwarding / HMR websocket                     | User-space proxy hop                                                                                                                                                                                                                       | Barely noticeable either way.                                                                        |
| File-watch events (HMR)                             | fsevents → inotify bridging through virtiofs                                                                                                                                                                                               | Same mechanism either way.                                                                           |

Side note (a correctness issue, not speed): the comment at `app_runtime_service.ts:917` says
"Docker installs use the container volume, not host node_modules", but the run command puts
`node_modules` in the bind-mounted host directory. Those are linux-musl binaries (esbuild, rollup,
etc.) sitting in the host tree. If the user switches back to `host` mode, they can break until
`node_modules` is wiped.

## Key constraint: host-side tooling reads `node_modules`

Dyad's Problems panel / `tsc` processor (`src/ipc/processors/tsc.ts`), the code explorer, and
the local agent's build/lint tools run **on the host** and read the app's `node_modules`. So the
main speed fix, keeping `node_modules` inside the VM or volume, removes the types those tools need.
This applies to Docker and a native VM equally. Options:

- Keep a host-side `node_modules` install for type info only (install twice; this defeats part of the win).
- Move type-checking/lint into the guest (a big change; all tool paths would have to become runtime-aware).
- Accept the virtiofs cost (today's behavior).

Whatever option we pick here has a bigger effect on the speed-vs-complexity trade-off than the
choice of hypervisor.

### E2E tests ("Run tests") already run on the host, even in Docker mode

- Docker/cloud runtimes can't use the sandboxed path (`usesSandboxedE2eTests` in
  `src/lib/e2eSandbox.ts` only allows host), so they use `runTestsAgainstNormalPreview`
  (`tests_handlers.ts` ~1614).
- `ensurePlaywrightBootstrap` (`playwright_bootstrap.ts` ~1719) runs the **host's** `pnpm`/`npm`
  to add `@playwright/test` to the app dir, and runs `playwright install chromium` on the host.
- The runner runs host `node` on `<app>/node_modules/@playwright/test/cli.js`
  (`playwrightCliInvocationForApp`, ~400), with a Mac Chromium (or the preview window via CDP).
  It tests against the container's published port on localhost.
- Nothing is run inside the container.

What this means:

- In Docker mode, host tools and the container share one `node_modules` directory: Dyad's host
  package manager writes to it, and the container reads it. A host `pnpm add` into a tree the
  container installed (linux-musl) could relink or replace platform-specific packages and break the
  container's next start (or the other way round). **This needs checking.**
- If `node_modules` moved into a VM/volume, "Run tests" would stop working. Either Playwright
  runs inside the guest (which needs a Linux browser in the image, and preview-window CDP routing
  across the VM boundary), or a separate host-side install is kept just for tests.
- Without the sandbox, there's no test isolation in Docker mode today: Neon-only apps are refused,
  and other apps run against the live preview and working tree. A VM runtime would have to
  rebuild the snapshot/dev-server sandbox inside the guest to match host mode.

## Options compared

### A. Improve Docker mode (lowest cost)

- One shared `dyad-runtime:node22` image, built or pulled once. Don't build per app, and don't
  write a `Dockerfile.dyad` into the user's repo.
- Store and `node_modules` on the same named volume (so pnpm can hardlink again), and handle the
  host-tooling problem above.
- Keep the container running across restarts and `docker exec` the dev server, instead of
  `run --rm` each time.
- It already works with OrbStack/Colima because Dyad just calls the `docker` CLI. We can point
  speed-sensitive users to OrbStack at zero cost.
- Complexity: small, and it stays inside the existing code paths.

### B. Apple `container` CLI as an alternative engine (medium cost)

- Apple's open-source tool (Containerization framework). Each container gets its own lightweight
  VM with fast boot, uses OCI images, and has Docker-like `run -v -p` flags.
- Dyad would add a small `ContainerEngine` abstraction (docker | apple-container) under the
  existing Docker code path.
- Limits: Apple silicon only; full networking needs macOS 26; the project is still pre-1.0 and its
  CLI surface is still changing. _(Check the current version and macOS requirements before starting.)_
- Benefits: no Docker Desktop, no always-on daemon VM. File sharing is still virtiofs, so the
  `node_modules` issue is the same as today.

### C. Dyad-managed Linux VM via Virtualization.framework (high cost)

Needs all of the following:

- A signed Swift helper with the `com.apple.security.virtualization` entitlement, added to the
  Electron Forge signing/notarization pipeline.
- Shipping and updating a Linux kernel plus rootfs (~100–300 MB download), including Node/pnpm
  upgrades inside the guest.
- A guest agent over vsock for exec, log streaming, signals and health checks. Today's
  `ChildProcess`-based `listenToProcess` / `runningApps` model assumes a local process or the
  `docker` CLI.
- virtiofs share setup, NAT networking/port access, disk growth and garbage collection, memory
  sizing, and recovery after crashes or sleep/wake.
- Covering every `runtimeMode2` branch listed above, plus deciding whether sandboxed E2E, isolated
  build, and Neon test isolation work in the VM (today they're host-only).
- **Testing:** GitHub-hosted Apple-silicon macOS runners don't support nested virtualization, so
  CI can't run it end-to-end. It would need self-hosted Mac hardware.
- Platform reach: macOS only (Intel Macs need a separate x86 guest image). Windows/Linux users
  would still use Docker, so we'd maintain two container stacks.
- Speed: about the same as A or B once `node_modules` placement is fixed. Boot/idle memory
  would be somewhat better than Docker Desktop and about the same as B.

### D. macOS guest VMs

Not a good fit. The images are tens of GB, boot is slow, Apple's license allows only 2 concurrent
guests, and the apps are Linux/Node web apps anyway.

## Recommendation

1. **Measure first.** Benchmark a scaffold app in host vs. Docker Desktop vs. OrbStack. Measure
   cold install, warm restart, time to first preview paint, and HMR latency after an edit. If most
   of the gap is `pnpm install` and module resolution over virtiofs, that confirms the analysis above.
2. **Do option A** (shared image, same-volume store, persistent container) and decide on the
   host-tooling/`node_modules` question. This gets most of the speed that's available.
3. **Consider option B** only if "requires Docker Desktop" becomes the real problem (install
   friction, licensing, RAM). Add it behind the engine abstraction, not as a fourth `runtimeMode2`.
4. **Don't build option C** unless isolation or security (not speed) becomes a product
   requirement that neither Docker nor Apple `container` can meet.

## Open questions for the user

- Why do users pick Docker mode today? Isolation, reproducibility, or avoiding a local Node
  install? The answer changes which option is worth building.
- Is it OK for macOS-only runtime features to diverge from Windows?
- Do we have usage telemetry for `runtimeMode2 = docker` to size the audience?
