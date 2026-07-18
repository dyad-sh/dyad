# Version preview state machine (vanilla TypeScript)

## Status

Implemented in `src/version_preview/` (see "Implementation notes" for the
few places the implementation deliberately deviates from the design below).

This document supersedes the earlier XState-versus-vanilla comparison. The
decision is recorded below; the rest of the document is the design for the
chosen option.

## Implementation notes

Deviations made during implementation, with reasons:

1. **A `notify-error` command was added** to the command vocabulary. The
   branch-unavailable toast must fire only when the resolution completion
   survives the controller's staleness check, so it is emitted by the
   machine as data rather than toasted by the adapter. All other toasts
   (raw mutation errors, IPC warning messages) remain adapter concerns.
2. **Controllers are cached per app, not disposed on `closed`.** Disposal
   would churn controller identity under mounted `useSyncExternalStore`
   subscribers; an idle closed controller is a few hundred bytes.
3. **Runtime refresh/restart runs inside the checkout command execution**
   (still within the `checking-out` state) rather than fire-and-forget.
   This removes the stale-restart race by construction. Failures are logged
   and never converted into `CHECKOUT_FAILED` (invariant 10 holds). A
   cloud-mode checkout of a DB-snapshot version now restarts once, not
   twice as before.
4. **Switching apps closes the pane for the new app** (the new app has no
   session). The old behavior kept the pane open showing the new app's
   versions while silently dropping the old app's return branch.
5. **`selectedVersionIdAtom` kept its name.** It is documented as
   presentation-only at the definition and is never read by the machine;
   renaming it across five consumers was churn without safety value.
6. **`resolving-origin` is defensive about unreachable shapes**: if it ever
   held a checkout, close/failure paths return or fall back to previewing
   instead of abandoning the checkout. Reachable sessions never hit this.

## Decision record

**Chosen: a vanilla TypeScript state machine** — a pure transition function
plus a small serial command executor. XState was considered and rejected for
this workflow:

1. **The workflow neutralizes XState's headline advantage.** The Git mutations
   here (checkout, revert, return) run over IPC and are not cancellable.
   Actor cancellation cannot undo them; both designs must hold the machine in
   the mutating state until the command settles. XState's remaining freebie —
   actor-scoped disposal of stale read results — covers exactly one operation
   in this workflow (origin-branch resolution).
2. **It would be an island.** The repository has no XState, no reducers, and
   no machine vocabulary anywhere. One flat eight-state machine does not
   justify a new dependency (`xstate` plus `@xstate/react`) and a v5
   actor-model learning curve for every future contributor who touches
   version history and nothing else.
3. **The end-state favors plain TypeScript.** The planned follow-up moves
   session ownership into the main process. A dependency-free
   `transition(state, event) → { state, commands }` function moves across the
   IPC boundary nearly verbatim; an XState machine would be rewritten or drag
   the dependency into the main process.
4. **The safety comes from the model, not the library.** Discriminated-union
   states, exhaustive transitions, and serialized commands provide the actual
   guarantees. The library was only ever a delivery mechanism for that model.

The trade we are accepting: we own a small amount of runtime the library
would have provided (operation identity, serial execution, subscriptions).
The complexity budget in this plan caps that runtime so it cannot silently
grow into an in-house actor framework. If the budget is exceeded, that is
evidence the decision should be revisited — see "Guardrails."

## Context

Commit `b249bb40` correctly removed the unsafe fallback to `main` and captures
a live return branch before checking out a historical version. It also exposed
that Version History is an orchestration workflow, not ordinary component
state.

The workflow is currently spread across (all in
`src/components/chat/VersionPane.tsx`, ~1,000 lines):

- `selectedVersionIdAtom` (`src/atoms/appAtoms.ts`), which is also used by
  unrelated diff-view UI;
- React state mirrored into refs (`isVisibleRef`, `wasVisibleRef`,
  `currentAppIdRef`, `liveVersionsRef`);
- `previewRequestIdRef` request counters used to reject stale results;
- refs holding promises and inferred repository state
  (`activePreviewCheckoutPromiseRef`, `checkedOutVersionIdRef`,
  `returnBranchRef`, `isResolvingPreviewBranchRef`,
  `isPreviewCheckoutInProgressRef`);
- async effects that infer open/close transitions from prop edges; and
- mutation state supplied by separate React Query hooks
  (`useCheckoutVersion`, `useCurrentBranch`, `useVersions`).

This permits states that should be impossible and makes recovery depend on
React lifecycle timing:

- clearing the selected diff can prevent the close path from restoring Git;
- switching apps discards the old app's return branch instead of completing
  recovery for the old app;
- closing while the initial versions refresh is pending can miss the close
  transition;
- a failed return clears the branch needed by the advertised retry action;
- restore, checkout, close, and reopen operations can overlap; and
- unmounting the pane invalidates local refs without restoring the repository.

## Goals

- Make every Git-affecting state and transition explicit.
- Ensure only one mutating Git operation runs per app at a time.
- Retain recovery information until Git has actually returned to a safe branch.
- Bind every preview session to the app that created it, even if selection
  changes later.
- Treat close, app switch, and unmount as events, not effect cleanup.
- Separate repository state from version-diff presentation state.
- Reject stale asynchronous results without coordinating refs in React.
- Make transition behavior testable without rendering `VersionPane`.
- Preserve the fail-safe behavior introduced by `b249bb40`: never guess a
  return branch and never silently fall back to `main`.

## Non-goals

- Redesigning version history, favorites, notes, search, or virtualization.
- Moving React Query's IPC-backed version list into Jotai or the machine.
- Changing the semantics of restore/revert in the first migration.
- Making Git operations cancellable when the underlying IPC operation is not.
- Guaranteeing recovery after a full Electron process crash; that requires
  main-process ownership and is a planned follow-up (see below).

## Required domain invariants

1. `originBranch` is captured immediately before the first historical
   checkout.
2. Once captured, `originBranch` is immutable for the lifetime of the session.
3. The session retains its original `appId`; it never substitutes the
   currently selected app.
4. `checkedOutVersionId` is machine-owned repository state. It is never
   inferred from a writable UI atom.
5. `targetVersionId` and `checkedOutVersionId` are different concepts.
6. A close or app-switch request received during a mutating operation is
   stored as an exit intent. A competing mutation does not start until the
   active one settles.
7. A failed return enters a recoverable state that retains `appId`,
   `originBranch`, and `checkedOutVersionId`.
8. The session reaches `closed` only after it no longer owns a historical Git
   checkout, or after no historical checkout was ever started.
9. Read-only completions (origin resolution) may be dropped when superseded.
   Mutation completions are never dropped: every mutating command's
   settlement is delivered to the machine before the next Git transition is
   decided.
10. UI refresh and runtime restart failures do not rewrite the machine's
    belief about which Git ref was successfully checked out.

## Domain model

All types are plain TypeScript with no imports beyond other domain types.

```ts
type ExitIntent =
  | { type: "none" }
  | { type: "close" }
  | { type: "switch-app"; nextAppId: number };

interface PreviewSession {
  appId: number;
  originBranch: string | null;
  targetVersionId: string | null;
  checkedOutVersionId: string | null;
  exitIntent: ExitIntent;
}

type PreviewState =
  | { type: "closed" }
  | { type: "browsing"; session: PreviewSession }
  | { type: "resolving-origin"; session: PreviewSession }
  | { type: "checking-out"; session: PreviewSession }
  | { type: "previewing"; session: PreviewSession }
  | { type: "restoring"; session: PreviewSession }
  | { type: "returning"; session: PreviewSession }
  | {
      type: "recovery-required";
      session: PreviewSession;
      error: SerializedError;
    };
```

```ts
type PreviewEvent =
  // UI intents
  | { type: "OPEN"; appId: number }
  | { type: "CLOSE" }
  | { type: "APP_CHANGED"; nextAppId: number }
  | { type: "SELECT_VERSION"; versionId: string }
  | { type: "RESTORE" }
  | { type: "RETRY_RETURN" }
  // Command completions (dispatched only by the controller)
  | { type: "ORIGIN_RESOLVED"; branch: string }
  | { type: "ORIGIN_RESOLUTION_FAILED"; error: SerializedError }
  | { type: "CHECKOUT_SUCCEEDED" }
  | { type: "CHECKOUT_FAILED"; error: SerializedError }
  | { type: "RESTORE_SUCCEEDED" }
  | { type: "RESTORE_FAILED"; error: SerializedError }
  | { type: "RETURN_SUCCEEDED" }
  | { type: "RETURN_FAILED"; error: SerializedError };
```

```ts
type PreviewCommand =
  | { type: "resolve-origin"; appId: number }
  | { type: "checkout"; appId: number; versionId: string }
  | { type: "return"; appId: number; branch: string }
  | { type: "restore"; appId: number; versionId: string; targetBranch: string };
```

Note: `restore` maps to the existing `ipc.version.revertVersion` contract
(`src/ipc/types` → `revertVersion`), which already accepts a
`targetBranchName`. The command vocabulary uses domain language; the adapter
does the translation.

### Transition function

```ts
interface TransitionResult {
  state: PreviewState;
  commands: PreviewCommand[];
}

function transition(state: PreviewState, event: PreviewEvent): TransitionResult;
```

Rules that make this "world-class" rather than merely adequate:

- **Total.** Every `(state, event)` pair returns a result. Unhandled pairs
  return `{ state, commands: [] }` explicitly via a shared `ignore(state)`
  helper — never by falling through — so a reviewer can distinguish
  "deliberately ignored" from "forgot to handle." A runtime totality test
  enumerates the full state×event matrix (see Test strategy).
- **Pure.** No I/O, no `Date`, no randomness, no imports beyond types.
  Deterministic: same state + event → same result, always.
- **Exhaustive by construction.** `switch` on `state.type` with a `never`
  check; inner switches on `event.type` with explicit `ignore` defaults.
- **Commands are data.** The transition function never executes anything; it
  returns commands for the controller to run.
- **At most one mutating command per result.** Enforced by a dev-mode
  assertion in the controller (defense in depth; the state graph already
  guarantees it).

### Transition matrix

States not listed for an event ignore it. "record intent" means the session's
`exitIntent` is updated and no command is emitted.

| State               | Event                      | Next state                                                                                                                               | Commands                                  |
| ------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `closed`            | `OPEN(appId)`              | `browsing` (fresh session)                                                                                                               | —                                         |
| `browsing`          | `SELECT_VERSION`           | `resolving-origin` (target set)                                                                                                          | `resolve-origin`                          |
| `browsing`          | `CLOSE` / `APP_CHANGED`    | `closed`                                                                                                                                 | —                                         |
| `resolving-origin`  | `ORIGIN_RESOLVED`          | `checking-out` (originBranch captured)                                                                                                   | `checkout`                                |
| `resolving-origin`  | `ORIGIN_RESOLUTION_FAILED` | `browsing` (target cleared)                                                                                                              | —                                         |
| `resolving-origin`  | `SELECT_VERSION`           | `resolving-origin` (latest target; supersedes in-flight resolve)                                                                         | `resolve-origin`                          |
| `resolving-origin`  | `CLOSE` / `APP_CHANGED`    | `closed` (no checkout ever started)                                                                                                      | —                                         |
| `checking-out`      | `CHECKOUT_SUCCEEDED`       | `previewing`, or `returning` if exit intent recorded                                                                                     | `return` when exiting                     |
| `checking-out`      | `CHECKOUT_FAILED`          | `previewing` if a prior checkout exists, else `browsing`; `returning` if exit intent recorded and a prior checkout exists, else `closed` | `return` when exiting with prior checkout |
| `checking-out`      | `CLOSE` / `APP_CHANGED`    | `checking-out` (record intent)                                                                                                           | —                                         |
| `checking-out`      | `SELECT_VERSION`           | ignored (see Resolved decisions)                                                                                                         | —                                         |
| `previewing`        | `SELECT_VERSION`           | `checking-out` (originBranch NOT recaptured)                                                                                             | `checkout`                                |
| `previewing`        | `RESTORE`                  | `restoring`                                                                                                                              | `restore`                                 |
| `previewing`        | `CLOSE` / `APP_CHANGED`    | `returning`                                                                                                                              | `return`                                  |
| `restoring`         | `RESTORE_SUCCEEDED`        | `closed` (restore lands on origin branch; no return needed)                                                                              | —                                         |
| `restoring`         | `RESTORE_FAILED`           | `previewing`, or `returning` if exit intent recorded                                                                                     | `return` when exiting                     |
| `restoring`         | `CLOSE` / `APP_CHANGED`    | `restoring` (record intent)                                                                                                              | —                                         |
| `returning`         | `RETURN_SUCCEEDED`         | `closed`                                                                                                                                 | —                                         |
| `returning`         | `RETURN_FAILED`            | `recovery-required` (full session + error retained)                                                                                      | —                                         |
| `returning`         | `CLOSE` / `APP_CHANGED`    | `returning` (already exiting; update intent)                                                                                             | —                                         |
| `recovery-required` | `RETRY_RETURN`             | `returning`                                                                                                                              | `return`                                  |
| `recovery-required` | `OPEN` / `SELECT_VERSION`  | ignored — recovery must resolve first                                                                                                    | —                                         |

Two rows deserve emphasis because they encode current bugs:

- `resolving-origin` + `CLOSE` → `closed` with no command: closing while the
  initial branch lookup is pending must not require a return, because no
  checkout ever happened. Today this path can be missed entirely.
- `returning` + `RETURN_FAILED` → `recovery-required` retains the session:
  today a failed return clears `returnBranchRef`, breaking the advertised
  retry.

## Architecture

### Module layout

Follows the repository's snake_case feature-directory convention
(`src/preview_panel/`, `src/ipc/`):

```text
src/version_preview/
  state.ts        // PreviewState, PreviewEvent, PreviewCommand, PreviewSession
  transition.ts   // pure transition function; zero non-type imports
  controller.ts   // VersionPreviewController: command execution, subscriptions
  commands.ts     // VersionPreviewCommands interface + IPC adapter
  registry.ts     // app-keyed controller registry (module scope)
  debug.ts        // dev-only ring-buffer event log
src/hooks/
  useVersionPreview.ts   // React binding via useSyncExternalStore
```

`transition.ts` importing anything with side effects (React, Jotai, ipc,
logging) is a lint-visible design violation and should fail review.

### Controller

One controller per session. Responsibilities, in full:

1. Hold `state: PreviewState` and expose `getSnapshot()` /
   `subscribe(listener)` — the exact contract `useSyncExternalStore` needs.
   Snapshots are immutable; every accepted event produces a new object.
2. `send(event)`: run `transition`, store the new state, execute returned
   commands, notify listeners. Synchronous from the caller's perspective;
   command completions arrive later as new events.
3. Execute commands **serially**: mutating commands (`checkout`, `return`,
   `restore`) may never overlap. The state graph guarantees this; the
   controller asserts it (throw in dev, log via the renderer logger in prod).
4. Own operation identity for the single read command: each `resolve-origin`
   dispatch increments a private `resolveEpoch`; a completion tagged with a
   stale epoch is dropped before it becomes an event. Mutation completions
   are never epoch-filtered (invariant 9). This is the **only** place
   operation identity exists — it never appears in React, in state, or in
   events.
5. Never touch the DOM, React, or UI atoms. Its only outputs are state
   snapshots and command executions.

The complexity budget (see Guardrails) caps this file. There is no generic
scheduler, no command queue beyond the in-flight promise, no timers, and no
retry logic — retry is a domain event (`RETRY_RETURN`), not an executor
feature.

### Command boundary

```ts
interface VersionPreviewCommands {
  getCurrentBranch(appId: number): Promise<{ branch: string }>;
  checkoutVersion(appId: number, versionId: string): Promise<void>;
  restoreVersion(input: {
    appId: number;
    versionId: string;
    targetBranch: string;
  }): Promise<void>;
}
```

The production adapter in `commands.ts` calls `ipc.version.*` directly —
**not** the React Query mutation hooks — so commands cannot capture the
currently selected app or depend on a mounted component. The adapter also
absorbs the side effects the hooks perform today, preserving behavior:

- increment/decrement `activeCheckoutCounterAtom` (`src/store/appAtoms.ts`)
  around checkouts, via the Jotai store instance, so unrelated UI that gates
  on active checkouts keeps working;
- invalidate `queryKeys.branches.current` and `queryKeys.versions.list` for
  the command's `appId` after successful mutations, via an injected
  `QueryClient`;
- surface `warningMessage` from `CheckoutVersionResponse` as a toast; and
- in cloud runtime mode, restart the app after checkout — as a
  **post-success effect** whose failure is reported as a warning toast and
  never converted into `CHECKOUT_FAILED` (invariant 10). Runtime sync
  failures are not machine events at all; the machine's Git belief is
  settled the moment the IPC mutation resolves.

Every command receives and preserves an explicit `appId` captured at session
start. A late completion can therefore never act on a newly selected app.

### Controller lifetime and registry

`registry.ts` holds a module-scope `Map<appId, VersionPreviewController>`:

- `ensureController(appId)` creates on demand (on `OPEN`).
- A controller that reaches `closed` is disposed and removed.
- A controller in `recovery-required` is **retained even if no component is
  subscribed**, so recovery survives pane unmounts, chat navigation, and app
  switches.
- On app switch, `ChatPanel` sends `APP_CHANGED(nextAppId)` to the old app's
  controller. The old session drains in the background (returns the old
  app's repository) while the UI proceeds to the new app. If the background
  return fails, the retained `recovery-required` controller drives a global
  recovery toast naming the old app, with a working `RETRY_RETURN`.

The registry is deliberately not a Jotai atom: the controller must outlive
React, and `useSyncExternalStore` is the standard, tear-free way to bind
external stores to React 18+. Jotai remains in use for what it already owns
(`activeCheckoutCounterAtom`, presentation atoms).

### React binding

```ts
function useVersionPreview(appId: number | null) {
  const controller = appId !== null ? ensureController(appId) : null;
  const state = useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.getSnapshot ?? closedSnapshot,
  );
  return { state, send: controller?.send ?? noopSend };
}

function useVersionPreviewRecovery(): RecoverySnapshot[];
// subscribes to the registry; returns all sessions in recovery-required,
// across apps, to drive the global recovery toast.
```

`ChatPanel` stops owning `isVersionPaneOpen` as separate `useState`; pane
visibility becomes `state.type !== "closed"`, and the open/close buttons send
`OPEN`/`CLOSE`. This deletes the visibility-edge-detection effect in
`VersionPane` outright — there is no longer a prop edge to infer.

### Observability

`debug.ts` keeps a ring buffer of the last ~100
`{ state.type, event.type, commands }` entries per controller, logged through
the existing renderer logger at debug level and exposed on
`window.__dyadVersionPreviewLog` in dev builds. This is the vanilla answer to
the XState inspector: when a rare race is reported, the reproduction is a
readable event trace, and any trace replays deterministically through
`transition` in a test.

## Guardrails (complexity budget)

These replace the earlier dual-implementation spike. The vanilla design is
accepted as long as it stays inside this budget; exceeding the budget is the
signal to stop and revisit the library decision rather than grow an in-house
framework:

- `transition.ts`: pure, zero non-type imports, no escape hatches.
- `controller.ts`: at most ~200 lines excluding types and comments; no
  timers, no generic command queue, no hierarchical/parallel state concepts,
  no dynamic actor spawning.
- Operation identity: exactly one epoch counter, private to the controller.
  If a second identity mechanism becomes necessary, the budget is exceeded.
- If a future requirement introduces delayed transitions, cross-machine
  choreography, or more than one concurrent machine instance per app, write
  a short decision note before building any of it in-house.

## Resolved decisions

Decisions the previous document left open, now fixed:

1. **Controller lifetime**: module-scope registry keyed by `appId`
   (`registry.ts`), bound to React with `useSyncExternalStore`. Not hosted in
   `ChatPanel` state and not a Jotai atom.
2. **Selection during checkout**: ignored, with rows visibly disabled and the
   active row showing progress. Last-selection-wins queuing is a possible
   later enhancement; it is excluded from the safety migration.
3. **App navigation**: proceeds immediately. The old session drains in the
   background; a failed background return surfaces the global recovery toast.
   Navigation never blocks on Git.
4. **Refresh/runtime restart**: post-success effects inside the command
   adapter, reported as warnings. Never modeled as machine states and never
   able to rewrite Git belief.
5. **Main-process sessions**: follow-up project, not part of this migration
   (see below).

## Migration plan

### Phase 1: characterize current behavior

- Add focused regression coverage for the unsafe scenarios not currently
  represented:
  - clear diff selection, then close;
  - app switch while previewing;
  - close while the initial versions refresh is pending;
  - return failure followed by a real retry;
  - close while restore is pending;
  - close/reopen while return is pending; and
  - pane unmount while previewing.
- Separate expected fail-safe behavior from behavior that merely reflects the
  current implementation.

### Phase 2: domain machine, no integration

- Add `src/version_preview/state.ts` and `transition.ts` with the full
  transition matrix above.
- Add the totality test, scenario tests, and invariant checks (see Test
  strategy). No React, no IPC, no component changes in this phase.

### Phase 3: controller and command adapter

- Add `controller.ts`, `commands.ts`, `registry.ts`, `debug.ts`.
- Test the controller against a fake `VersionPreviewCommands` implementation
  with manually resolved deferred promises.
- Verify the adapter preserves today's side effects: checkout counter atom,
  query invalidation, warning toasts, cloud-mode restart.

### Phase 4: host the controller above `VersionPane`

- Bind `ChatPanel` to `useVersionPreview`; derive pane visibility from
  machine state; convert open/close buttons to `OPEN`/`CLOSE` events.
- Send `APP_CHANGED` from the app-selection path to the old app's controller.
- Add the global recovery toast driven by `useVersionPreviewRecovery`, with a
  real `RETRY_RETURN` action.

### Phase 5: separate presentation from repository state

- Split `selectedVersionIdAtom` into presentation-only state for the version
  diff. `VersionPane`, `CodeView`, `CommitMenu`, `ModifiedFilesCard`, and
  `PreviewToolbar` consume the narrower presentation contract.
- Derive selected/loading/disabled row UI from the machine snapshot.
- Clearing a diff must never change repository recovery behavior. This phase
  is independently valuable and may ship as its own PR ahead of phase 6.

### Phase 6: remove legacy orchestration

- Delete from `VersionPane`: `previewRequestIdRef`,
  `activePreviewCheckoutPromiseRef`, `checkedOutVersionIdRef`,
  `returnBranchRef`, `isResolvingPreviewBranchRef`,
  `isPreviewCheckoutInProgressRef`, `wasVisibleRef`/`isVisibleRef`, and the
  visibility-edge async effect.
- Keep note-save refs (`noteSaveTimeoutsRef`, `noteSaveSequencesRef`)
  untouched; note debouncing is a separate workflow, not repository state.
- Reduce component tests to rendering and event wiring; transition
  permutations live in the phase-2/3 tests.

### Phase 7: validate

- Run the machine/controller test suites.
- Run `src/components/chat/VersionPane.test.tsx`.
- Run `src/ipc/handlers/__tests__/undo.integration.test.ts` to preserve
  restore semantics.
- Run `npm run fmt`, `npm run lint`, and `npm run ts` before committing.
- If application code is exercised through E2E, run `npm run build` before
  the focused E2E test.

## Test strategy

### Transition tests (pure, no mocks)

- **Totality**: enumerate every `(state.type, event.type)` pair with
  representative payloads; assert `transition` returns without throwing and
  the result passes the invariant checker. This is the vanilla replacement
  for a statechart visualizer — the matrix is verified, not just drawn.
- **Invariant checker**: a single `assertInvariants(prev, event, next)`
  helper encoding invariants 1–10 (e.g. `originBranch` never changes once
  set; `closed` is unreachable while `checkedOutVersionId` is non-null unless
  the last event was `RETURN_SUCCEEDED` or `RESTORE_SUCCEEDED`). Applied in
  every transition test.
- **Sequence fuzzing**: a seeded PRNG generates a few thousand random event
  sequences; each step asserts invariants. Seeded, so failures reproduce.
- **Scenario tests** (the named races):
  - first preview captures the branch exactly once;
  - later previews reuse the immutable origin branch;
  - latest selection wins while origin resolution is pending;
  - selection is ignored while a Git mutation is active;
  - close during checkout waits, then returns;
  - close during origin resolution closes without any Git command;
  - app switch drains the old app before its session is discarded;
  - restore success performs no additional return checkout;
  - restore failure remains recoverable;
  - return failure preserves every retry input;
  - retry success is the only transition that clears recovery data; and
  - a superseded origin resolution cannot advance the session.

### Controller tests (fake commands, deferred promises)

- No two mutating command promises are ever in flight together, including
  when completion events arrive in adversarial orders.
- Commands always use the session's captured `appId`, including after
  `APP_CHANGED`.
- A stale `resolve-origin` completion is dropped; a mutation completion never
  is.
- Unsubscribing every listener does not dispose a controller in
  `recovery-required`.
- A late completion produces exactly one event and no listener notification
  storms.

### Component tests

- Row selection sends `SELECT_VERSION`; close sends `CLOSE`; recovery UI
  sends `RETRY_RETURN`. Components never perform Git work.
- Buttons, disabled states, and progress labels derive from machine states.
- Search, note, favorite, and virtualization behavior remains independent.

### Integration/E2E

- Preserve the existing return-to-captured-branch and no-`main`-fallback
  cases.
- One integration test that clears diff presentation state before closing and
  still observes a return checkout.
- One app-switch integration test proving the old app is restored.
- A focused Electron E2E only if the component/integration harnesses cannot
  prove controller survival across the real pane lifecycle.

## Product and UX implications

- The common case remains simple: select a version, inspect it, close.
- Consequential Git work becomes visible through explicit states such as
  "Preparing preview," "Returning to branch," and "Recovery required."
- While a mutation is active, controls communicate why they are disabled
  rather than silently ignoring clicks.
- A failed return offers a real retry using retained context — including
  after switching apps — not an action that merely reopens the pane.
- The UI never claims a return succeeded before the command settled.

## Follow-up: main-process preview sessions

The renderer machine protects against React races but cannot guarantee
recovery after a renderer crash or full app exit. A later, separately planned
hardening moves session ownership and per-app Git serialization into the main
process behind contract-driven IPC:

```ts
const session = await ipc.version.beginPreview({ appId });
await ipc.version.preview({ sessionToken: session.token, versionId });
await ipc.version.endPreview({ sessionToken: session.token });
```

The vanilla design was chosen partly for this: `state.ts` and `transition.ts`
have zero renderer dependencies and can move to the main process verbatim,
with the controller reduced to an IPC client. The follow-up requires
app-id/session-token validation, cleanup policy, and main-process integration
tests, and is intentionally excluded from this migration to keep it
reviewable.

## Acceptance criteria

- No preview-specific request IDs, promise refs, or mirrored React/ref
  booleans remain in `VersionPane`.
- Repository recovery does not depend on `selectedVersionIdAtom` or pane
  visibility state.
- Every Git mutation is serialized and uses an explicit captured `appId`.
- A failed return retains a working retry path, including across app
  switches and pane unmounts.
- App switching cannot abandon the old app on a historical checkout.
- The unsafe `main` fallback remains absent.
- `transition.ts` has no non-type imports; `controller.ts` is within the
  complexity budget.
- The totality test covers the full state×event matrix; machine/controller
  tests cover transition permutations while component tests cover rendering
  and event wiring.
- Focused tests, formatting, linting, and TypeScript checks pass before the
  implementation is committed.
