# Better Version Preview State-Machine Architecture

## Status

Proposed implementation plan, revised after review. Three decisions from that
review are incorporated here:

1. **Single writer.** Every version repository mutation — including
   restore-to-message and the undo/retry revert flows — is dispatched by the
   state machine. No renderer code calls version-mutation IPC directly except
   the machine's command adapter.
2. **No generic state-machine kernel yet.** Only the keyed lifecycle host and
   React subscription adapter are extracted as reusable code. Transition,
   event, command, and executor types stay domain-specific until a second
   machine exists.
3. **Selection lives in the machine.** Version selection and diff-file
   presentation move into the app-keyed machine session. The singleton Jotai
   atoms are deleted rather than replaced with an app-keyed Jotai map.
4. **Recovery notifications are commands.** Surfacing, re-surfacing, and
   dismissing the recovery toast are explicit machine commands (like the
   existing `notify-error`), not a value-equal state-identity change. The
   resurface-nonce machinery in `registry.ts` is never ported to the new
   manager.

## Goals

1. Route all version repository mutations through the state machine so mutual
   exclusion and repository truth have exactly one owner.
2. Move version-selection and diff presentation into the machine session so
   selection has one owner and one lifecycle.
3. Return authoritative command-result metadata from the main process.
4. Replace the module-global registry with a small generic keyed-controller
   lifecycle host plus an explicit, provider-owned version-preview manager.
5. Drive recovery toasts through explicit machine commands, eliminating the
   snapshot-identity re-surface hack and the nonce machinery built around it.
6. Broaden adapter coverage and add one real lifecycle E2E test.

## Non-goals

- Adopt XState or build a generic state-machine framework. No generic
  `StateMachineDefinition`/`CommandExecutor` interfaces are introduced in this
  plan; see "What is generic and what stays domain" for the rationale.
- Persist an in-progress preview session across an Electron process restart.
- Add cancellation for Git operations that are already in flight.
- Redesign the version pane, diff view, or restore confirmation UI.

Unlike the previous draft, changing the transition graph is **in scope**: the
graph gains events for restore-to-message and diff-file selection. The
user-visible flow is otherwise preserved, with one deliberate exception
documented in section 2 (selection is no longer restored after an app switch).

## Current architecture and its fault lines

The current implementation has the right central idea: callers send events
through a controller and render from the controller snapshot. The remaining
problems are around, not inside, that machine.

```text
React components
  | events                         | singleton presentation atoms
  v                                v
module-global registry -------> Jotai store
  | controller per app
  v
state machine                    ChatMessage / MessagesList
  | commands                       | revertVersion / restoreToMessage
  v                                v
renderer command adapter -- IPC --> main-process version handlers
  ^                                   |
  +---- infers effects from caches ---+
```

Six issues follow from this shape:

- **A second writer exists.** `ChatMessage.tsx` and `MessagesList.tsx` mutate
  the repository through `useVersions` (`revertVersion`,
  `restoreToMessage`) without going through the machine. The machine
  serializes its own mutations (`isMutatingState`, `mutationInFlight`) but
  cannot see these, so an out-of-band revert can race a machine checkout, and
  after one succeeds the machine's `checkedOutVersionId` is stale truth.
  `selectedVersionReturnBranchAtom` exists only to smuggle machine state
  (the origin branch) out to this bypass path.
- **Selection has two owners with different lifetimes.** The selected version,
  diff file, and return branch are singleton atoms even though a user can
  switch between apps, and the machine already computes
  `diffVersionIdForState()` from its own session.
- The renderer reconstructs facts such as whether a runtime restart is
  required and which chat changed. Its inputs can be stale by the time an IPC
  mutation finishes.
- `registry.ts` owns controllers, runtime initialization, recovery entries,
  and listeners in module globals. This hides lifecycle and makes test
  isolation depend on reset functions.
- **A one-shot effect is smuggled through snapshot identity.**
  `recovery-required` + `OPEN` returns a fresh, value-equal state object
  purely so subscribers re-notify and the recovery toast re-surfaces
  (`transition.ts`). The registry then needs a `resurfaceNonce` counter plus
  a memoized equality dance (~60 lines) to separate that signal from the
  noise the hack itself created — and correctness depends on the
  controller's reference-inequality notify, so a future value-equality
  "optimization" would silently kill re-surfacing.
- App-switch draining is detected by a React `useEffect` diffing
  `selectedAppIdAtom`; a lifecycle-critical policy depends on render timing.
- Controller and transition tests are strong, but the command adapter's
  cache-independent behavior and the full app-switch lifecycle are not proven
  end to end.

## Target ownership model

```text
VersionPreviewProvider (one per renderer application root)
  |
  +-- VersionPreviewManager (domain facade)
  |     +-- KeyedControllerHost<VersionPreviewController>
  |     |     +-- one controller per appId
  |     |     +-- app-scoped snapshots/subscriptions/disposal
  |     +-- version-preview recovery policy and entries
  |     +-- app-switch return policy (subscribes to the Jotai store directly)
  |     +-- renderer command adapter (the ONLY caller of version-mutation IPC)
  |
  +-- TanStack Query: IPC-backed server/main-process data
        +-- apps, versions, chats, settings

main-process IPC handlers
  +-- perform the mutation under the app-scoped lock
  +-- report the effects that actually occurred
```

The ownership rules are explicit:

- The state machine is authoritative for repository workflow state — phase,
  previewed commit, origin branch, pending operation, recovery — **and is the
  only dispatcher of repository mutations**. If code wants to mutate the
  repo, it sends the machine an event.
- The machine session also owns ephemeral presentation selection (selected
  version, selected diff file). Presentation fields never gate Git
  transitions.
- Jotai owns no version-preview state. (`selectedAppIdAtom` remains; it is
  app-shell state, not version state.)
- TanStack Query owns data read through IPC.
- The main process is authoritative for mutation effects because it has the
  locked app, version metadata, settings, and the result of each side effect.
- The command adapter applies returned effects; it does not rediscover them
  from renderer caches.

## What is generic and what stays domain

The previous draft extracted a generic kernel
(`StateMachineDefinition<State, Event, Command, Input>`,
`CommandExecutor<Command, Event, Context>`, a generic controller). That is
dropped, for two reasons:

1. **One client.** Version preview is the only machine. Generic interfaces
   designed from a single client encode its accidents: the `Input` parameter
   had no client at all (the initial state is the constant `CLOSED_STATE`).
2. **The generalization was semantically wrong.** A uniform
   "stale completions can be ignored" epoch mechanism contradicts the current
   controller's documented invariant: _mutation completions are never
   dropped_ (`controller.ts`). Only the origin-resolution read uses
   latest-wins epochs. A generic controller would need per-command
   concurrency policy — a design decision that should wait for a second data
   point.

What is extracted instead is the lifecycle machinery, which is genuinely
domain-independent today:

```ts
interface KeyedController {
  getSnapshot(): unknown;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

class KeyedControllerHost<K, C extends KeyedController> {
  constructor(create: (key: K) => C);
  ensure(key: K): C;
  get(key: K): C | undefined;
  keys(): K[];
  subscribeKey(key: K, listener: () => void): () => void;
  subscribeAny(listener: () => void): () => void;
  disposeKey(key: K): void;
  dispose(): void;
}
```

The host owns:

- lazy controller creation per key;
- per-key and any-key subscriptions, with cleanup;
- disposal of one key or the whole host;
- a generic `useKeyedController(host, key, selectSnapshot)` adapter over
  `useSyncExternalStore` with stable snapshot identity.

The host must not own:

- transition or command semantics of any kind;
- recovery, app-switch policy, IPC, query invalidation, or notifications;
- any import from version preview, TanStack Query, Jotai, or toast code.

`VersionPreviewController` keeps its current domain-specific shape (pure
`transition()` plus command execution with per-command concurrency rules).
The second, third, and fourth machines have since arrived (PRs #3968 plan
handoff, #3969 app run, #3970 connection flow) and confirmed this split:
their concurrency models all differ, while their lifecycle plumbing is
identical. `plans/machine-followup.md` owns the shared-kernel scope
(`KeyedControllerHost`, snapshot store, transition types, test kit) and the
migration of the other machines; whichever plan lands first creates
`src/state_machines/`, and the other consumes it unchanged.

## 1. Single writer for repository mutations

### Route restore-to-message through the machine

Today `ChatMessage.tsx` calls `restoreToMessage` (IPC
`restoreToMessageVersion`) with `targetBranchName` read from
`selectedVersionReturnBranchAtom`, and `MessagesList.tsx` calls
`revertVersion` for undo/retry flows. Both bypass the machine.

Extend the machine instead:

```ts
// New/changed events
| { type: "RESTORE"; appId: number; versionId: string }
| {
    type: "RESTORE_TO_MESSAGE";
    appId: number;
    chatId: number;
    messageId: number;
    restoreCodebase: boolean;
  }

// New/changed commands
| { type: "restore"; appId: number; versionId: string; targetBranch: string | null }
| {
    type: "restore-to-message";
    appId: number;
    chatId: number;
    messageId: number;
    restoreCodebase: boolean;
    targetBranch: string | null;
  }
```

Transition rules:

- `closed` + `RESTORE`/`RESTORE_TO_MESSAGE` → `restoring` with a fresh
  session. `originBranch` is `null`, so the command's `targetBranch` is
  `null` and the handler restores onto the live branch (today's
  no-`targetBranchName` behavior).
- `browsing` behaves like `closed` (no checkout is owned yet).
- `previewing` + either event → `restoring` with
  `targetBranch = session.originBranch`, exactly as the atom-passing path
  behaves today. Success lands on the origin branch, so the session ends and
  the state returns to `closed`.
- `checking-out` / `restoring` / `returning` / `recovery-required` ignore
  both events. The UI disables restore affordances from the machine snapshot
  (see below), so an ignored event is a race lost, not a UX dead end.

This gives real mutual exclusion: the transition matrix cannot start a
restore while another mutation is in flight, which the current
`isAnyVersionMutationPending` counter only approximates.

### Migrate the callers

- `ChatMessage.tsx` sends `RESTORE_TO_MESSAGE` via `useVersionPreview(appId)`
  instead of calling the mutation. Navigation to the `newChatId` created by
  the restore becomes a post-effect applied by the command adapter from the
  IPC result (section 3), so the component no longer orchestrates it.
- `MessagesList.tsx` undo/retry flows send `RESTORE` events.
- `useVersions` drops `revertVersion` and `restoreToMessage` mutations and
  keeps read queries. `isAnyVersionMutationPending` is replaced by a
  derivation from the machine snapshot (`isMutatingState`), exposed through
  the version-preview hooks. Note this also deletes the
  `onMutate`/`mutationAppId` staleness workaround in `useVersions.ts` — the
  session owns its `appId`, so the completion cannot attribute effects to the
  wrong app.
- Delete `selectedVersionReturnBranchAtom` and the `VersionPane.tsx` effect
  that mirrors machine state into it. No `getReturnBranch()` accessor is
  added to the manager — with all mutations routed through the machine,
  nothing outside it needs the origin branch.

### Acceptance criteria

- Exactly one module (the command adapter) invokes
  `ipc.version.checkoutVersion`, `revertVersion`, and
  `restoreToMessageVersion`.
- Starting a restore while a machine mutation is in flight is structurally
  impossible, not merely improbable.
- After any restore (pane, message, undo/retry), the machine's state matches
  the repository: no stale `previewing` state survives an out-of-band revert,
  because out-of-band reverts no longer exist.
- The origin branch exists only inside the machine session.

## 2. Selection state lives in the machine session

### Data model

Add presentation fields to the session instead of creating an app-keyed Jotai
map:

```ts
export interface PreviewSession {
  appId: number;
  originBranch: string | null;
  targetVersionId: string | null;
  checkedOutVersionId: string | null;
  exitIntent: ExitIntent;
  /** Presentation only. Never used to decide Git transitions. */
  selectedDiffFile: { versionId: string; path: string } | null;
  /** Presentation only; closing it never returns or checks out a branch. */
  isDiffVisible: boolean;
}
```

Presentation events mutate these fields without emitting repository commands:

```ts
| { type: "SELECT_DIFF_FILE"; file: { versionId: string; path: string } | null }
| { type: "CLOSE_VERSION_DIFF" }
| { type: "VIEW_VERSION_DIFF"; appId: number; versionId: string; file: ... }
```

Rules:

- `SELECT_DIFF_FILE` is honored while a diff is visible and ignored elsewhere.
  It emits no commands, ever.
- Read-only diffs opened from chat use a non-pane-visible `viewing-diff` state,
  so chat stays mounted while the Code panel shows the requested commit.
- `CLOSE_VERSION_DIFF` only clears diff presentation; `CLOSE` remains the
  repository-workflow exit that returns an owned historical checkout.
- Selecting a different version clears `selectedDiffFile`.
- The "selected version" is already in the machine (`targetVersionId` /
  `diffVersionIdForState()`); consumers read it from the snapshot instead of
  `selectedVersionIdAtom`. No second copy exists to fall out of sync.

Delete `selectedVersionIdAtom` and `selectedVersionDiffFileAtom` from
`src/atoms/appAtoms.ts` (`selectedVersionReturnBranchAtom` is deleted by
section 1).

### Deliberate behavior change

Selection now dies with the session. Switching from app A to app B drains app
A's session (background return to the origin branch) and closes it; coming
back to app A shows live state with no restored selection. The previous
draft's criterion — "returning to app A restores its presentation selection" —
is dropped on purpose: it restored a selection pointing at a version that was
no longer checked out, for a pane that was no longer open. If
persist-across-close selection is ever wanted, it must be validated against
the machine snapshot at read time; do not resurrect a second store with an
independent lifetime.

### Consumer migration

Update these consumers to read selection from `useVersionPreview(appId)`
snapshots (via small selector helpers, e.g. `selectedDiffFile(state)`,
`selectedVersionId(state)`), passing an explicit `appId` in reusable leaf
components:

- `src/components/chat/ChatMessage.tsx`
- `src/components/chat/ModifiedFilesCard.tsx`
- `src/components/chat/VersionPane.tsx`
- `src/components/preview_panel/CodeView.tsx`
- `src/components/preview_panel/PreviewToolbar.tsx`
- `src/components/preview_panel/CommitMenu.tsx`
- `src/components/preview_panel/VersionDiffView.tsx`

If profiling shows selection-only consumers re-rendering too often on machine
transitions, add a selector variant of the hook
(`useVersionPreviewSelector(appId, selector, isEqual)`); do not solve it by
moving state back out of the machine.

### Acceptance criteria

- No version-preview selection state exists outside machine snapshots.
- Cross-app leaks are structurally impossible: selection lives in an
  app-keyed controller, so app B cannot observe app A's session.
- Selecting a diff file never triggers a Git command and never changes
  workflow phase.
- Deleting an app disposes its controller; there is no separate presentation
  cleanup path to forget.
- `SELECT_DIFF_FILE` produces a new state object for the owning app only;
  subscribers of other apps are not notified.

## 3. Authoritative command-result metadata

### Define a shared result contract

Add a result schema to `src/ipc/types/version.ts` and use it for all
version-preview mutations:

```ts
const VersionCommandResultSchema = z.object({
  repositoryOutcome: z.enum(["target-applied", "unchanged"]),
  notification: z
    .object({
      kind: z.enum(["success", "warning"]),
      message: z.string(),
    })
    .nullable(),
  runtimeAction: z.enum(["none", "restart"]),
  affectedChatId: z.number().nullable(),
  /** Set only by restore-to-message when a new chat was created. */
  createdChatId: z.number().nullable(),
});
```

The contract is capability-oriented: `runtimeAction: "restart"` tells the
renderer what to do without exposing Neon- or cloud-specific logic across the
IPC boundary. `repositoryOutcome` lets the machine distinguish a completed
restore from fork-only or warning/no-op restore-to-message results; it must not
discard an owned preview session unless main confirms the target was applied.

### Make checkout intent semantic

Do not infer "return to the live branch" from `gitRef === "main"`. A
repository's live branch need not be named `main`, and a commit/ref could
collide with that convention.

Change the checkout input to a discriminated union:

```ts
type CheckoutVersionInput =
  | { purpose: "preview"; appId: number; versionId: string }
  | { purpose: "return"; appId: number; branch: string };
```

The handler chooses database/environment behavior from intent rather than
string comparison. Audit and migrate every `checkoutVersion` caller in the
same change so the contract cannot be used ambiguously. (After section 1
there should be exactly one caller: the command adapter.)

### Compute metadata where the mutation happens

Within the app-scoped lock, the main-process handlers accumulate effects from
operations that actually completed:

- Set `runtimeAction` to `restart` when the mutation changed the runtime
  environment or when the active runtime requires a restart after
  synchronization.
- Return the actual affected chat ID found while resolving a restore target,
  and `createdChatId` when restore-to-message created a new chat.
- Return success or warning text as structured notification metadata.
- Leave chat fields null for operations that did not touch a chat.

If lower-level helpers such as `revertCodebaseToVersion` perform environment
changes, extend their internal return value so the IPC handler receives facts
instead of re-querying or predicting them.

### Simplify the renderer adapter

Update `src/version_preview/commands.ts` so each command:

1. invokes IPC;
2. performs unconditional query invalidations required by the mutation;
3. applies the returned result through one shared
   `applyVersionCommandResult(result)` helper (`runtimeAction`,
   `affectedChatId` refresh, `createdChatId` navigation, notification);
4. balances the version-operation counter in `finally`.

Remove correctness decisions based on:

- `hasDbSnapshot` supplied by the UI/controller;
- cached settings;
- a post-mutation app fetch used only to infer runtime behavior;
- `selectedChatIdAtom` read after restore completion.

Because the main process now decides `runtimeAction`, the renderer no longer
needs `hasDbSnapshot` at all: delete the field from events, session, and
commands once the metadata contract lands. The domain model shrinks with the
inference it existed to feed.

The adapter may use `getQueryData` only for optional display enrichment.
Missing or stale cache data must not change mutation correctness.

### Failure boundary

A failed IPC mutation remains a command failure and drives the machine's
failure event. A renderer post-effect failure — a query invalidation, chat
navigation, or runtime refresh failure after Git already succeeded — must not
make the controller believe the Git mutation failed.

Implement this boundary explicitly:

- apply the required mutation result first;
- report post-effect errors through logging/telemetry and a user-visible
  warning where appropriate;
- do not transition the machine back to a repository state that is no longer
  true.

### Acceptance criteria

- The renderer never decides restart behavior from app/version/settings cache
  state; `hasDbSnapshot` no longer appears in the domain model.
- Restore refreshes the chat identified by the main process, and
  restore-to-message navigates to the chat the main process created, even if
  the user changes selected chat while IPC is pending.
- Returning to a non-`main` origin branch performs return semantics
  correctly.
- A successful Git mutation followed by a failed renderer refresh does not
  produce a false repository-state rollback.
- IPC inputs and outputs remain schema-validated and inferred by
  `IpcMainInvokeEvent` types.

## 4. Lifecycle host and explicit manager instead of module globals

### Generic primitives

Add under `src/state_machines/`:

- `keyed_host.ts` — `KeyedControllerHost` as specified above;
- `react.ts` — `useKeyedController`, a `useSyncExternalStore` adapter with
  stable snapshot identity;
- tests for both, written against a trivial fake controller, with
  notification-count assertions.

Do not add generic transition/command/executor types, and do not introduce a
global registry of hosts. Providers construct the hosts they need.

### Recovery notifications as explicit commands

"Re-surface the recovery toast" is a one-shot effect, and the machine already
has the right primitive for effects: commands executed by the runtime
(`notify-error` is the precedent). Replace the identity-change signaling with
commands:

```ts
// state.ts — new commands
| { type: "notify-recovery"; appId: number; error: PreviewError }
| { type: "dismiss-recovery"; appId: number }
```

Transition changes:

- `returning` + `RETURN_FAILED` → `recovery-required`, emitting
  `notify-recovery`.
- `recovery-required` + `OPEN` → **same state, same reference**, emitting
  `notify-recovery`. The `{ ...state }` clone is deleted; states change
  reference only when they change value.
- `recovery-required` + `RETRY_RETURN` → `returning`, emitting
  `dismiss-recovery` alongside the return command.
- `returning` + `RETURN_SUCCEEDED` needs no dismiss: the retry path already
  dismissed on `RETRY_RETURN`. If a future path can leave recovery without
  passing through `RETRY_RETURN`, it must emit `dismiss-recovery`.

The command adapter implements both with the toast layer exactly as
`notify-error` does today: `toast.error` with a stable per-app id,
`duration: Infinity`, and a Retry action that sends `RETRY_RETURN` through
the manager; `toast.dismiss` for the counterpart. One non-transition dismiss
path remains: `manager.disposeApp(appId)` (app deletion) must dismiss any
outstanding recovery toast for that app before disposing the controller.

This deletes, rather than ports, the compensating machinery in
`registry.ts`: `recoveryNonceByAppId`, the `resurfaceNonce` entry field,
`sameRecoveryEntries()`, and the `recoveryCache`/`lastRecoveryEntries`
identity dance. Recovery entries — still exposed for UI that lists stuck
apps — become a plain derived view over controller snapshots: filter for
`recovery-required`, memoized by the snapshots themselves, which are now
reliably reference-stable.

### Version-preview facade

Replace `src/version_preview/registry.ts` with a thin
`src/version_preview/manager.ts` facade:

```ts
class VersionPreviewManager {
  constructor(deps: {
    host: KeyedControllerHost<number, VersionPreviewController>;
    store: JotaiStore; // for selectedAppIdAtom subscription
  });

  getSnapshot(appId: number): PreviewState;
  send(appId: number, event: PreviewEvent): void;
  subscribeApp(appId: number, listener: () => void): () => void;

  getRecoveryEntries(): VersionPreviewRecoveryEntry[];
  subscribeRecovery(listener: () => void): () => void;

  disposeApp(appId: number): void;
  dispose(): void;
}
```

The generic host owns the controller map, per-app subscriptions, and
disposal. The facade owns only domain policy:

- version-preview controller construction (definition + command adapter
  wiring);
- **app-switch return policy, subscribed directly on the Jotai store**
  (`store.sub(selectedAppIdAtom, ...)`) at construction time and released in
  `dispose()`. Draining the previous app's session must not depend on a React
  effect firing; the provider owns the manager's lifetime, not its policy
  timing.
- recovery entries as a plain derived view over controller snapshots (no
  nonces — see "Recovery notifications as explicit commands"), plus recovery
  listeners for that view;
- dismissing an app's outstanding recovery toast in `disposeApp()`.

There is no `getReturnBranch()`: section 1 removed its only consumer.

Keep controller creation lazy per app, but make both manager creation and
ownership explicit. `dispose()` disposes the host, unsubscribes from the
store, and clears recovery subscriptions.

### Provider and hooks

Create `VersionPreviewProvider` near the renderer application root. It:

- obtains the stable query client and Jotai store;
- constructs one command adapter, host, and manager for the provider
  lifetime (ref or stable memo);
- exposes the manager through React context;
- disposes the manager on unmount.

Both React bridges are gone: the manager owns app-switch draining, and
recovery toasts are issued and dismissed by machine commands through the
adapter. The provider is pure context plumbing.

Hooks:

- `useVersionPreview(appId)` wraps `useKeyedController` and returns the
  snapshot plus `send`.
- `useVersionPreviewManager()` supports imperative operations such as app
  deletion (`manager.disposeApp(appId)`).
- `useVersionPreviewRecovery()` subscribes only to recovery entries.

Use `useSyncExternalStore` with stable snapshot identities. A change to app A
must not rerender hooks subscribed to app B.

### Remove global lifecycle workarounds

Delete:

- lazy "first caller initializes runtime" behavior;
- module-level controller/recovery/listener collections;
- `resetVersionPreviewForTests` and tests that depend on it;
- direct registry imports from renderer components/pages.

Tests construct a fake command adapter, host, and manager, then dispose them
normally. This makes lifecycle behavior production-shaped and allows multiple
isolated managers in one test process.

### Acceptance criteria

- No mutable version-preview controller, runtime, listener, or recovery
  collection exists at module scope.
- Provider mount/unmount fully defines manager lifetime.
- `src/state_machines/` has no imports from version preview, IPC, TanStack
  Query, Jotai, or notification code.
- App-switch draining works without any React component subscribed to
  `selectedAppIdAtom`, and is tested without rendering.
- Two manager instances can run in one process without sharing state.
- App-specific events notify only app-specific subscribers.
- App deletion and renderer teardown dispose controllers and listeners
  deterministically, and app deletion dismisses that app's recovery toast.
- No state snapshot ever changes reference without changing value; recovery
  re-surfacing is observable as a command in pure transition tests, not as
  an identity side channel.

## 5. Broader tests and one lifecycle E2E test

Tests are added alongside each phase rather than deferred until the end.

### Transition tests (extended)

The existing totality/invariant suite in `transition.test.ts` extends to the
new events:

- `RESTORE` and `RESTORE_TO_MESSAGE` from `closed`, `browsing`, and
  `previewing`, including `targetBranch` null versus origin;
- both events ignored in every mutating and recovery state;
- `SELECT_DIFF_FILE` honored only while a version diff is visible, never emitting
  commands, cleared on version change; read-only `viewing-diff` presentation
  stays outside Version History and `CLOSE_VERSION_DIFF` never emits Git work;
- explicit branch switching works from a closed machine and preserves the
  previous owned session if checkout fails;
- restore-to-message completion distinguishes `target-applied` from
  `unchanged`, retaining preview ownership for fork-only and warning outcomes;
- `RETURN_FAILED` emits `notify-recovery`; `OPEN` in `recovery-required`
  returns the same state reference and emits `notify-recovery`;
  `RETRY_RETURN` emits `dismiss-recovery` with the return command;
- invariant: no transition returns a value-equal state with a new reference;
- invariant: presentation fields never appear in command payload decisions.

### Host, manager, and provider tests

- independent controllers for two app IDs;
- app-specific subscriptions do not notify unrelated app consumers
  (notification-count assertions);
- app switch during preview triggers return for the previous app, driven by
  a direct store write — no React involved;
- recovery entries derive correctly from controller snapshots (creation,
  removal, reference stability across unrelated controller activity);
- `notify-recovery`/`dismiss-recovery` reach the adapter's toast functions
  on failure, re-open, retry, and `disposeApp`;
- disposal unsubscribes (host, store subscription, recovery) and prevents
  later notifications;
- two manager instances in one process are fully isolated without a global
  reset helper;
- provider unmount/remount constructs a fresh manager and disposes the old
  one.
- React StrictMode effect replay does not dispose the live manager or leak the
  discarded render initializer's store subscription.

### Command adapter tests

Expand `src/version_preview/commands.test.ts` with table-driven cases for
every command and both success and failure paths:

- checkout preview and return;
- restore version and restore-to-message (including `createdChatId`
  navigation);
- resolve current version;
- empty query caches;
- local, cloud, and database-enabled outcomes represented purely by returned
  metadata;
- success and warning notifications;
- exact affected-chat refresh even when the selected chat changes mid-flight;
- version-operation counter balance on IPC rejection and post-effect
  rejection;
- Git/IPC failure versus renderer post-effect failure;
- no decision-making reads from settings, app, version, or selected-chat
  caches.

### IPC handler contract tests

Add focused handler or integration tests for:

- preview versus return intent, including a non-`main` origin branch;
- `runtimeAction` matching actual environment changes;
- the resolved `affectedChatId` for message-linked and commit-linked
  versions, and `createdChatId` for restore-to-message;
- warning/success notification propagation;
- schema rejection of ambiguous checkout inputs.

Use the IPC integration harness if real handler wiring, sqlite state, or fake
runtime routes are required; keep pure result aggregation tests at the unit
level.

### One packaged lifecycle E2E

Add `e2e-tests/version_preview_lifecycle.spec.ts` with one focused scenario:

1. Create app A and create at least two committed versions with distinct
   visible content.
2. Create app B.
3. In app A, preview the older version, select a diff file, and verify the
   content is visible.
4. Switch to app B.
5. Verify app B shows no version/diff presentation.
6. Poll app A's repository until it is back on its original branch with a
   clean worktree.
7. Return to app A and verify the live version is visible, the UI is not in
   preview mode, and no stale selection is shown.

This validates the real Electron shell, manager lifecycle, background Git
return, and machine-owned presentation together. Keep mid-operation ordering
and recovery edge cases deterministic in manager/controller tests rather than
adding production delays to the E2E.

Before running the E2E, rebuild the application:

```sh
npm run build
npx playwright test e2e-tests/version_preview_lifecycle.spec.ts
```

## Implementation sequence

### Phase 0: Characterize existing behavior

- Run the current transition, controller, command, and component tests.
- Add missing characterization tests for app-switch return, recovery, and —
  new — the current restore-to-message and undo/retry behavior, since the
  transition graph now changes underneath them.

### Phase 1: Extract the host and introduce the manager/provider

User-visible behavior is preserved. The one graph change in this phase is
deliberate: replace the recovery re-surface identity hack with
`notify-recovery`/`dismiss-recovery` commands _before_ building the manager,
so the nonce machinery is deleted rather than migrated and `manager.test.ts`
never encodes it.

- Add `KeyedControllerHost` and `useKeyedController` with their tests.
- Convert recovery notifications to commands in `state.ts`/`transition.ts`
  and implement them in the command adapter; delete the `{ ...state }`
  re-notify branch.
- Move version-only recovery (as a plain derived view) and app-switch policy
  into `VersionPreviewManager`; app-switch subscribes to the store directly.
- Add the provider and hooks; migrate registry consumers and deletion
  cleanup.
- Replace reset-based tests with manager instances; delete `registry.ts`.

### Phase 2: Single writer

- Extend the graph with `RESTORE` (from closed/browsing) and
  `RESTORE_TO_MESSAGE`; extend the restore command payloads.
- Migrate `ChatMessage.tsx` and `MessagesList.tsx` to machine events; remove
  the mutations from `useVersions`; derive pending state from the snapshot.
- Delete `selectedVersionReturnBranchAtom` and the `VersionPane` mirror
  effect.

### Phase 3: Selection into the session

- Add `selectedDiffFile` and `SELECT_DIFF_FILE`; migrate all presentation
  consumers to snapshot reads.
- Delete `selectedVersionIdAtom` and `selectedVersionDiffFileAtom`.
- Add two-app selection isolation tests.

### Phase 4: Authoritative mutation results

- Add the discriminated checkout intent, shared result schema, and
  restore-to-message result fields.
- Change lower-level main-process helpers to report actual effects; update
  handlers to return metadata within the locked mutation.
- Simplify the adapter around `applyVersionCommandResult`; delete
  `hasDbSnapshot` from the domain model.
- Add adapter and IPC handler coverage before removing old inference inputs.

### Phase 5: Prove the composed lifecycle

- Add the packaged Electron lifecycle E2E.
- Run targeted suites, full static checks, build, and the new E2E.
- Manually inspect that app switching, restore-to-message, and recovery
  notifications remain understandable to the user.

## Expected file map

Likely new files:

- `src/state_machines/keyed_host.ts`
- `src/state_machines/keyed_host.test.ts`
- `src/state_machines/react.ts`
- `src/state_machines/react.test.tsx`
- `src/version_preview/manager.ts`
- `src/version_preview/manager.test.ts`
- `src/version_preview/VersionPreviewProvider.tsx`
- `e2e-tests/version_preview_lifecycle.spec.ts`

Likely modified files:

- `src/version_preview/state.ts` — session presentation fields, new events,
  command payload changes, `hasDbSnapshot` removal
- `src/version_preview/transition.ts` and `transition.test.ts`
- `src/version_preview/controller.ts` — minor; keeps its domain shape
- `src/version_preview/commands.ts` and `commands.test.ts`
- `src/hooks/useVersionPreview.ts`
- `src/hooks/useVersions.ts` — mutations removed, reads kept
- `src/atoms/appAtoms.ts` — three atoms deleted
- `src/ipc/types/version.ts`
- `src/ipc/handlers/version_handlers.ts`
- `src/components/chat/ChatMessage.tsx`, `MessagesList.tsx`,
  `ModifiedFilesCard.tsx`, `VersionPane.tsx`
- `src/components/preview_panel/CodeView.tsx`, `PreviewToolbar.tsx`,
  `CommitMenu.tsx`, `VersionDiffView.tsx`
- the application layout/root that mounts renderer providers
- app deletion flows that currently dispose registry entries

Likely removed file:

- `src/version_preview/registry.ts`, after all imports have migrated

The exact handler test file should follow the existing IPC test organization
discovered during implementation rather than creating a parallel harness.

## Risks and mitigations

### Transition-graph changes

Unlike the previous draft, the graph changes (new restore paths, selection
events). The totality and invariant tests in `transition.test.ts` are the
safety net; extend them in the same commit as each graph change, and keep
Phase 0 characterization tests for the flows being rerouted.

### Restore-from-closed semantics

`RESTORE`/`RESTORE_TO_MESSAGE` from `closed` sends `targetBranch: null`,
relying on the handler's existing restore-onto-live-branch behavior when
`targetBranchName` is omitted. Verify that behavior with a handler test
before migrating callers.

### Selection persistence UX change

Selection is intentionally not restored after an app switch. Flag this in the
PR description and validate in Phase 5 manual inspection; if product wants
persistence, it must be re-added as machine-validated state, not a parallel
store.

### Imperative toast lifecycle

Command-driven toasts trade the self-healing reconcile-a-list bridge for
explicit dismiss paths. The dismiss set is small and closed — `RETRY_RETURN`
and `disposeApp` — but each must be tested, and any future transition that
exits `recovery-required` by a new route must emit `dismiss-recovery`. The
transition-test invariant ("no value-equal state with a new reference")
guards the other direction: nobody can quietly reintroduce identity
signaling.

### Provider initialization order

The manager needs the query client and Jotai store, so the provider mounts
below those providers and above all version-preview consumers. Construct once
with a ref or stable memo, and test unmount/remount explicitly.

### Premature framework growth

The reusable surface is deliberately only the keyed host and React adapter.
If a second machine appears mid-implementation, resist merging its needs into
this plan; extract shared controller mechanics as a follow-up informed by
both machines.

### `useSyncExternalStore` loops or broad rerenders

Snapshots must retain identity until the subscribed app changes. Keep
separate app and recovery listener sets, and add notification-count
assertions to manager tests. Selection now lives in the snapshot, so watch
for selection-only consumers over-rendering; add the selector hook variant if
profiling demands it.

### IPC contract migration

A discriminated input intentionally breaks every ambiguous caller at
type-check time. Migrate all callers in one phase and run `npm run ts` before
considering the phase complete. Removing the `useVersions` mutations gives
the same compile-time guarantee for the single-writer migration.

### Post-mutation partial failure

Git may succeed before a restart, navigation, or cache refresh fails.
Preserve repository truth in the machine and surface the secondary problem
separately. Add a test specifically for this split.

### E2E timing

Returning to the origin branch is asynchronous. Poll Git branch and worktree
state rather than using fixed sleeps, and keep the test to one lifecycle
scenario to limit flakiness and runtime.

## Verification checklist

Run the narrowest tests during each phase, followed by the complete
pre-commit checks:

```sh
npm test -- src/state_machines/keyed_host.test.ts
npm test -- src/state_machines/react.test.tsx
npm test -- src/version_preview/manager.test.ts
npm test -- src/version_preview/commands.test.ts
npm test -- src/version_preview/controller.test.ts
npm test -- src/version_preview/transition.test.ts
npm test -- src/components/chat/VersionPane.test.tsx
npm run fmt
npm run lint
npm run ts
npm run build
npx playwright test e2e-tests/version_preview_lifecycle.spec.ts
```

Adjust targeted component/handler paths to match the final test placement.
Inspect `git status` after formatter and lint fixes to ensure no unrelated
files changed.

## Definition of done

- Exactly one code path (the machine's command adapter) performs version
  repository mutations; restore-to-message and undo/retry are machine events.
- Version selection and diff presentation exist only in machine snapshots;
  the three singleton atoms are deleted.
- The return branch exists only in machine session state.
- Main-process version mutations return validated, authoritative result
  metadata, and `hasDbSnapshot` is gone from the domain model.
- The renderer adapter applies metadata without correctness-critical cache
  inference.
- The reusable surface is the keyed lifecycle host and React adapter only;
  no generic state-machine interfaces were introduced.
- Version-preview policy lives in a provider-scoped facade; app-switch
  draining is owned by the manager, not a React effect.
- Recovery toasts are issued and dismissed by machine commands; the
  resurface-nonce machinery and the value-equal state clone are gone, and no
  snapshot changes reference without changing value.
- All module-global version-preview lifecycle state is eliminated; two
  manager instances can coexist in one process.
- Unit/integration coverage exercises all command outcomes, the new restore
  paths, and multi-app manager behavior.
- One packaged Electron E2E proves preview, app switch, automatic return,
  isolation, and restoration to live state.
- Formatting, lint, type-check, build, targeted tests, and the lifecycle E2E
  pass.
