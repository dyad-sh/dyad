# Sandboxed app runtime for user-triggered E2E tests

## Status

Implemented for host-runtime test execution. The Tests panel and agent test tool
now use a disposable workspace, run-scoped server, sandbox-only Neon env, and
retained artifact directory. Interactive test recording remains on its existing
preview-oriented lifecycle and was deliberately not migrated.

## Problem

Neon test execution currently isolates the data but not the app runtime. Dyad
creates a temporary Neon branch, rewrites the real app's `.env.local`, and
restarts the user's existing preview against that branch. Playwright then uses
the existing preview proxy. While the run is active, any user interaction with
the preview therefore reaches the throwaway branch; setup and teardown also
interrupt the user's dev server.

The test runner also uses the real app directory as its working directory, so
reports and any test-time filesystem writes land in the user's project.

## Goal

Run user-triggered E2E tests against a disposable snapshot of the app with its own
environment, process, and port, while the normal preview continues running from
the real app directory and against the user's normal database configuration.

The sandbox must represent the app as it exists when Run is pressed, including
tracked modifications and relevant untracked/ignored runtime files. It must not
be limited to the last Git commit.

## Non-goals

- Do not change the recorder. Recording continues to drive the normal preview
  and use the existing database-isolation lifecycle.
- Do not replace the app preview iframe or introduce an Electron session
  partition.
- Do not copy test-generated source changes back into the real app.
- Do not limit the snapshot to committed Git state. Modified, deleted,
  untracked, and relevant ignored files must be overlaid from the live tree.
- Do not support concurrent test runs for the same app in the first version.
- Do not copy or link the live app's `node_modules` into the sandbox.
- Do not silently fall back to running a Neon test against the user's real
  database or normal preview when sandbox setup fails.

## Product behavior

1. The user presses Run while their normal preview is running.
2. Setup progress reports distinct steps: preparing Playwright if necessary,
   capturing the current app, installing clean dependencies, creating isolated
   data, and starting the test
   server.
3. The normal preview remains available and is neither stopped nor restarted.
4. Playwright targets the sandbox server URL only.
5. Stop terminates Playwright, then the sandbox server, then remote test-data
   resources, and finally deletes the sandbox directory.
6. Test results remain visible through the existing result model. Artifacts
   needed by the result UI are promoted to a Dyad-owned artifact directory
   before the sandbox is deleted.
7. A setup failure says which stage failed and confirms that the normal preview
   was not changed.

The first-ever Playwright bootstrap remains a transparent, one-time project
setup operation because it intentionally adds `@playwright/test`, Dyad's config,
and ignore entries to the user's app. It runs before the snapshot. Ordinary
runs after bootstrap do not mutate the real app.

## Proposed architecture

### 1. `E2eTestWorkspace`

Add an E2E-only workspace service, separate from database isolation:

```ts
interface E2eTestWorkspace {
  workspacePath: string;
  artifactPath: string;
  packageManager?: "npm" | "pnpm";
  dependencyInstallPath?: string;
  dispose(): Promise<void>;
}

createE2eTestWorkspace({
  appId,
  appPath,
  signal,
}): Promise<E2eTestWorkspace>
```

Place workspaces beneath a Dyad-owned user-data directory such as
`<userData>/test-sandboxes/<appId>/<runId>`, rather than beside the user's repo.
This gives startup reconciliation a bounded, recognizable cleanup root and
prevents temp-directory policy differences from leaking into the feature.

#### Snapshot strategy

Create a detached Git worktree at `HEAD`, then overlay the live repository
state: tracked modifications and deletions, untracked files, and relevant
ignored runtime inputs. Resolve paths relative to the Git top level so apps
nested in a monorepo retain their workspace manifests and lockfiles. Materialize
initialized submodules and validate/remap symlinks so the snapshot cannot read
or write through links into the live checkout.

Git provides the baseline and cleanup bookkeeping, but the overlay—not `HEAD`
alone—is the state tested. If the app is not in a healthy Git repository, fail
closed with a precondition error.

Exclude heavyweight or disposable roots, initially:

- `node_modules`
- framework output/caches: `dist`, `build`, `out`, `.vite`, `.next`, `.nuxt`,
  `.svelte-kit`, `.turbo`, `.cache`
- test output: `test-results`, `playwright-report`, `coverage`
- OS metadata such as `.DS_Store`

Do not use `.gitignore` wholesale. Ignored files can be runtime inputs, including
environment files and generated assets. Preserve all other files as they exist
on disk, including uncommitted and untracked files.

Never copy or link `node_modules`. For standard Dyad apps, resolve npm or pnpm
using the same package-manager policy as production builds and perform a clean
install in the snapshot (`npm ci` / `pnpm install --frozen-lockfile` when a
lockfile exists, with the existing socket-firewall policy). In monorepos,
install at the owning workspace root. Custom-command apps keep ownership of
their install/start sequence and skip this generic install stage.

#### Snapshot consistency

Take the snapshot while holding the app path and repository-worktree coordination
claims so Dyad-driven edits, restores, imports, and path changes cannot
interleave. Release those claims once the overlay is complete, before the clean
dependency install, so the user can keep editing while setup and Playwright run
against the captured state. External IDE writes cannot be made globally atomic;
document the snapshot boundary as the moment Run is pressed and make capture
failures fail closed.

### 2. `E2eTestDataIsolation`

Do not make `prepareIsolatedTestDatabase` serve two incompatible lifecycles.
Keep it unchanged for recording, including its real-preview restart and env
restoration behavior. Extract shared provider primitives where useful, then add
an E2E-only data-isolation service whose contract targets the workspace:

```ts
interface PreparedE2eTestData {
  isolation: TestIsolation;
  testCredentials?: Record<string, string>;
  applyToWorkspace(workspacePath: string): Promise<void>;
  dispose(): Promise<void>;
}
```

#### Neon

1. Create and durably track the temporary branch using the existing Neon branch
   primitives.
2. Read the captured workspace environment.
3. Call the existing framework-aware Neon env updater with `workspacePath`,
   never `realAppPath`.
4. Provision the optional Better Auth test account as today.
5. On cleanup, delete/mark the branch using the existing durable ordering.

There is no real `.env.local` restoration step because it was never changed.
Accordingly, remove E2E-only `envRestored` failure handling after migration;
retain it in the recorder path. Continue tracking the branch ID durably so a
crash can clean up a leaked remote branch even though the user's env is safe.

#### Supabase

Continue creating an RLS-scoped test user and cleaning up its data/user. The
sandbox runtime still provides filesystem/process isolation even though the
database endpoint does not change.

#### No database

Still use the workspace and test runtime. Return `mode: "none"` only for data
isolation; it must not mean runtime isolation was skipped.

#### Runtime modes

Implement the first version for host runtime. For Docker/cloud runtime, retain
the current behavior only where it is already safe and make the lack of runtime
sandboxing explicit in the UI. For Neon specifically, never degrade to the
normal preview/real database on sandbox failure. A later phase may provide
Docker-specific volumes or cloud sandbox clones behind the same contract.

### 3. `E2eTestRuntime`

Add a short-lived runtime owned by the test run:

```ts
interface E2eTestRuntime {
  baseUrl: string;
  processId?: number;
  stop(): Promise<void>;
}

startE2eTestRuntime({
  app,
  workspacePath,
  signal,
  onOutput,
}): Promise<E2eTestRuntime>
```

Extract and reuse app-runtime command detection, managed Node/pnpm selection,
environment construction, and readiness parsing where possible. Do not call the
normal `executeApp` path unchanged: it is keyed by `appId`, publishes into
`runningApps`, drives the app-run actor, owns the normal deterministic ports,
and could replace or stop the user's preview.

The test runtime must instead:

- have a run-scoped identity rather than using `appId` as a singleton key;
- run with `cwd: workspacePath`;
- receive a unique app port;
- remain outside `runningApps` and normal preview/app-run state;
- stream setup output into the existing test output channel with a clear
  `[test server]` prefix;
- resolve only after an HTTP readiness probe succeeds;
- stop only the exact child/process tree it started;
- never call a cleanup helper that kills an unknown process merely because it
  owns the desired port.

Prefer Playwright targeting the test dev server directly. It does not need the
normal preview proxy because there is no iframe, stable browser origin, or
preview navigation UI to preserve. When the disposable Neon branch has Auth
enabled, register the test server's exact run-scoped origin as a trusted domain
after its random port is known and before Playwright starts. Registration must
preserve the HTTP scheme rather than applying the HTTPS normalization used for
deployment domains, and must target only the disposable branch; teardown
deletes it with that branch. If authorization fails, stop before Playwright
rather than producing misleading per-test `INVALID_ORIGIN` failures. Do not
disable Better Auth's origin checks, use a loopback wildcard, or reuse the
normal app proxy.

Allocate an OS-available port and pass it through the same framework-specific
start-command machinery used by the normal runtime. Because selecting a free
port has a bind race, detect address-in-use startup failure and retry with a new
port a bounded number of times. Do not reserve a port by killing its listener.

### 4. Make the test core accept explicit execution inputs

Change `runAppTestsCore` so it no longer looks up the real app path and normal
preview URL internally:

```ts
runAppTestsCore({
  appId,
  appPath: workspace.workspacePath,
  baseUrl: testRuntime.baseUrl,
  artifactPath: workspace.artifactPath,
  // existing selector, output, timeout, and credential options
});
```

Keep path/URL resolution in the orchestration layer. Run `npx playwright` with
the sandbox as `cwd`, write the JSON report inside it, and parse paths relative
to the sandbox. Before disposal, copy retained traces/screenshots/report data to
the run's artifact directory and rewrite result attachment paths if the UI
stores them.

Bootstrap Playwright against the real app before workspace creation. This
preserves the current user-visible project setup semantics and ensures the
generated Dyad config, manifest change, and lockfile change are present in the
snapshot. The later clean install materializes those dependencies without
sharing the live dependency tree.

### 5. Lifecycle orchestration and coordination

Refactor the E2E handler into explicit stages with one cleanup stack:

```text
register run/cancellation owner
  -> bootstrap Playwright in real app (when required)
  -> snapshot workspace
  -> install clean dependencies in workspace (standard apps)
  -> prepare isolated test data in workspace
  -> start test runtime
  -> run Playwright against explicit baseUrl
  -> retain artifacts
finally
  -> stop Playwright/process tree
  -> stop test runtime
  -> dispose isolated data
  -> delete workspace
  -> publish terminal result
```

Register every acquired cleanup immediately after acquisition. Run cleanup in
reverse order and continue after individual cleanup failures, reporting all
failures without hiding the original run error. Cancellation must be checked
between every awaited setup stage. Teardown is not abortable once a remote
branch/user exists.

Do not hold the current broad coordinator claim for the entire Playwright run.
Use staged claims:

1. **Bootstrap/snapshot:** read `app-path` and `repository-ref`; claim
   `repository-worktree` and `test-files` while bootstrap files or the snapshot
   may change/read them. Release the claim before dependency installation.
2. **Provider lifecycle:** hold `provider` from temporary branch/user creation
   through deletion, preventing unlink/delete races.
3. **Sandbox runtime:** use a new run-scoped owner/registry rather than claiming
   the normal app `runtime` or `runtime-config`, because those claims would
   unnecessarily block the preview the feature is meant to preserve.

Audit app deletion, app relocation, provider unlink, Stop, replacement Run, and
application shutdown. These must cancel and await a run where required; they
must not delete provider state or the sandbox root while cleanup is active.
Preserve the existing same-app single-run controller ordering. Runs for
different apps may proceed concurrently once port and resource ownership are
run-scoped.

### 6. Crash recovery

On Dyad startup:

- remove abandoned directories only beneath the recognized `test-sandboxes`
  root and only when their ownership sidecar identifies an E2E Git worktree;
- unregister owned worktrees with Git before deleting their directories, then
  prune stale worktree metadata;
- never follow directory links during recursive cleanup;
- rely on the existing durable Neon branch marker/reconciliation to remove
  leaked remote branches;
- ensure no real-env restoration gate is applied to E2E-only leaked branches,
  because the real env was never modified;
- keep recorder recovery behavior unchanged.

The durable branch state may need to distinguish `recorder-env-swapped` from
`e2e-cleanup-only`; add that distinction before sharing startup reconciliation.
Do not infer it solely from whether a sandbox directory still exists.

## Implementation phases

### Phase 1: Workspace primitive and benchmarks

- Share the detached Git-worktree/live-overlay primitive used by production
  builds and add purpose-specific, Git-aware disposal.
- Share npm/pnpm workspace resolution and clean-install policy with production
  builds; never reuse the live `node_modules` tree.
- Add timing/size telemetry without recording absolute user paths.
- Benchmark representative Vite and Next apps on macOS, Windows, and Linux.
- Set a soft progress threshold (show ongoing file count/bytes after 500 ms),
  not a hard correctness timeout.

Exit criterion: a workspace contains current tracked/untracked source and env
files, reflects tracked deletions, excludes known heavy outputs, cannot mutate
real source, and can install resolvable dependencies from its manifests.

### Phase 2: Unregistered host test runtime

- Extract reusable command/env/readiness pieces from `app_runtime_service`.
- Implement the run-scoped process registry, port retry, output, readiness, and
  process-tree teardown.
- Prove that starting/stopping it does not change `runningApps`, the app-run
  actor, normal proxy URL, or normal preview process.

Exit criterion: normal and test servers run simultaneously from different
directories and ports, and stopping either leaves the other alive.

### Phase 3: E2E-only data isolation and runner wiring

- Add workspace-targeted Neon env rewriting and shared provider primitives.
- Keep the recorder on `prepareIsolatedTestDatabase` unchanged.
- Pass explicit `appPath`/`baseUrl` into `runAppTestsCore`.
- Promote artifacts, then dispose the sandbox.
- Replace E2E env-restoration messaging with sandbox-cleanup messaging.

Exit criterion: during a Neon test, the real `.env.local` is byte-identical,
the normal preview keeps its PID/URL and real branch, and Playwright reaches the
throwaway branch through the test server.

### Phase 4: Coordination, recovery, and rollout

- Narrow broad whole-run coordinator claims into staged ownership.
- Complete delete/relocate/unlink/shutdown/rapid-rerun audits.
- Add abandoned-workspace startup cleanup and distinguish durable Neon cleanup
  states.
- Gate the new path behind a temporary feature flag for soak testing, but fail
  closed rather than silently use the legacy runtime when the flag is enabled.
- Remove the legacy E2E env-swap path after cross-platform validation. Do not
  remove or redirect the recorder path.

## Test plan

### Unit tests

- Workspace filter includes modified/untracked/ignored runtime inputs and
  excludes every declared heavyweight root.
- LF/CRLF environment files remain valid and only sandbox Neon values change.
- Detached worktree creation overlays tracked deletions, nested-app paths, and
  submodules; cancellation removes a partial registered worktree.
- Npm/pnpm clean-install arguments honor lockfiles and monorepo membership;
  install failures are classified as setup preconditions.
- Sandbox disposal rejects paths outside its owned root and does not follow
  malicious links.
- Port collision retries without killing the existing listener.
- Cleanup stack runs in reverse order, attempts every cleanup, and preserves the
  primary error plus cleanup diagnostics.
- Explicit runner paths parse reports and attachments relative to the sandbox.

### Vitest integration tests

- Start a real fixture dev server normally, create a sandbox server, and assert
  distinct CWDs, PIDs, ports, and environment values.
- Modify and add fixture files before Run; assert the sandbox sees them while a
  post-snapshot edit affects only the normal workspace.
- Assert Playwright bootstrap happens before snapshot, then a clean install
  happens after the repository-worktree claim is released.
- Cancel during capture, dependency install, branch creation, server readiness,
  Playwright, and cleanup;
  assert no live child/workspace remains and remote cleanup is attempted.
- Start Run twice rapidly; assert the second waits for the first cleanup and
  cannot delete the successor's workspace or branch.
- Delete/unlink/relocate/shutdown coordination tests prove there is no orphaned
  process or provider race.
- Recorder regression tests assert it still uses the existing preview-oriented
  isolation service and restart behavior.

### Playwright E2E coverage

Add one broad test using a fixture app whose page displays a server-read env
marker:

1. Start the normal preview with marker `real` and capture its PID/URL.
2. Run a test with sandbox marker `isolated`.
3. While it is running, verify the normal preview still displays `real` and is
   interactive.
4. Verify the generated test observes `isolated`.
5. Stop or finish the run and assert the original PID/URL and `.env.local`
   content never changed.
6. Assert the sandbox process/directory is gone and retained results remain
   readable.

Add a second targeted cancellation case only if the integration harness cannot
exercise real process-tree teardown reliably.

## Observability and acceptance criteria

Log structured timings for bootstrap, snapshot capture, dependency install,
data setup, server readiness, test execution, artifact promotion, and cleanup.
Include app ID/run ID but never env contents, credentials, or absolute project
paths.

The feature is complete when:

- the real app environment is byte-identical before, during, and after E2E;
- the normal preview process and URL do not change during E2E;
- Playwright can only reach the sandbox server URL supplied to its config;
- current uncommitted and relevant untracked files are tested;
- test writes and reports do not pollute the real app;
- Stop and app shutdown leave no child process, sandbox, test user, or Neon
  branch after cleanup/reconciliation;
- filtered workspace creation is normally faster than test-server startup;
- Windows fallback performance is measured and acceptable;
- recorder behavior and its tests are unchanged.

## Key risks and mitigations

- **Dependency state leaks from the live app:** exclude `node_modules` from the
  overlay and use a clean, sandbox-local install with lockfile enforcement.
- **Framework command logic diverges:** extract command construction/readiness
  from the normal runtime rather than duplicating it.
- **Artifacts disappear with the workspace:** promote them before disposal and
  test every attachment path consumed by the UI.
- **External editor writes during capture:** coordinate all Dyad writers and define
  a best-effort on-disk snapshot boundary; fail on inconsistent filesystem
  errors rather than silently mixing in the real directory later.
- **Port race:** bounded retry on bind failure; never kill an unknown listener.
- **Crash leaks remote data:** preserve durable branch markers and distinguish
  E2E cleanup-only state from recorder env-restoration state.
- **Sandbox cleanup escapes its root:** validate canonical containment and do
  not traverse links.
- **Normal preview is accidentally registered/restarted:** keep the test runtime
  out of `runningApps` and add assertions around the app-run actor and proxy.

## Likely code areas

- `src/ipc/handlers/tests_handlers.ts`: orchestration, explicit runner inputs,
  cancellation, artifacts, and staged coordination.
- `src/ipc/services/isolated_test_db.ts`: recorder-compatible service remains;
  extract only provider primitives shared with the new E2E service.
- `src/ipc/services/app_runtime_service.ts`: extract reusable command/env and
  readiness helpers without reusing singleton runtime registration.
- New `src/ipc/services/e2e_test_workspace.ts`.
- New `src/ipc/services/e2e_test_runtime.ts`.
- New `src/ipc/services/e2e_test_data_isolation.ts`.
- `src/ipc/utils/playwright_bootstrap.ts`: split mutating bootstrap from sandbox
  readiness verification.
- `src/ipc/utils/neon_test_branch.ts`: durable cleanup-state distinction.
- Startup reconciliation and app deletion/shutdown paths that currently recover
  or stop tests.
- Unit/integration tests beside each service plus one broad packaged E2E spec.
