# Jotai State Ownership

Use Jotai for client-only state, not as a second cache for IPC data.

## No root Provider: production uses the default store

The renderer mounts no root Jotai `<Provider>`, so production components and
`useStore()` resolve to jotai's default store, while tests wrap components in
`<Provider store={createStore()}>`. Module-scope services that read/write atoms
outside React must receive the store from `useStore()` at initialization
instead of importing `getDefaultStore()`, or test stores will silently diverge
from the store the service writes to.

## Version preview state is machine-owned

Git preview orchestration lives in the main-owned app-keyed actor under
`src/version_preview/`. Its renderer provider owns only window-local
presentation state such as pane visibility and selected diff file. Never add a
parallel Jotai atom for the selected version, return branch, or mutation status;
read the remote actor snapshot and send revisioned events through
`useVersionPreview(appId)`. Mutation IPC is not a renderer escape hatch:
checkout, restore, switch, and recovery commands execute behind the main actor.

Derive UI visibility and action availability from the lifecycle state as well
as retained session fields. Returning/recovery states may intentionally retain
historical session data, but must hide stale presentation and consistently
block events that those states reject.

## Ownership

- React Query owns server/IPC-backed data such as apps, chats, versions,
  settings, env vars, providers, files, diagnostics, and reports.
- Router/search params own primary navigation identity. If an atom mirrors a
  route value, keep writes centralized in route-level synchronization code or a
  navigation helper.
- Jotai owns client-only UI state that must survive component unmounts:
  selected UI modes, edit buffers, optimistic content, and transient
  presentation state shared across distant components. Machine lifecycle,
  queues, streaming status, and external-runtime status stay in their
  authoritative snapshots/read models.
- React local state owns form fields, modal visibility, measurement, and state
  used by a single component subtree.

Each Electron renderer window has an independent Jotai store. Treat that as a
per-window presentation boundary, never as shared cross-window authority.
Shared facts belong in a main-owned actor/read model or React Query and arrive
through subscriptions/invalidation. One-way machine outcomes may update
window-local presentation atoms only at the permanent, commented write sites
inventoried by `src/state_machines/boundaries.test.ts`.

## Entity Scoping

When state belongs to an entity, key it by that entity id instead of using a
singleton selected-entity value.

Good examples:

```ts
chatInputValuesByIdAtom: Map<number, string>;
terminalOpenByChatIdAtom: Map<number, boolean>;
dismissedImageGenerationJobIdsAtom: Set<string>;
```

Avoid unkeyed global booleans for entity-specific async work. A value like
`loading: boolean` is only safe when exactly one operation can own it. Prefer
an app/chat/job keyed map and derive the currently visible value from the
selected id.

## Derived Atoms

Expose derived atoms or domain hooks for "current selected" reads:

```ts
currentTestSpecsAtom = atom((get) => {
  const appId = get(selectedAppIdAtom);
  return appId == null ? [] : (get(testSpecsByAppIdAtom).get(appId) ?? []);
});
```

Components should usually read `currentTestSpecsAtom` rather than repeat
`selectedAppIdAtom` plus raw map lookup logic.

## Updates

- Use write-only atoms or domain helper hooks for repeated mutations such as
  append, clear, set-for-id, or remove-for-id.
- Keep high-frequency state, such as logs, separate from slower state so a log
  append does not rerender consumers of unrelated preview metadata.
- Combine fields only when they form one domain concept and are updated
  together. Do not create one mega atom for unrelated state.
- Always clone `Map` and `Set` values before modifying them so Jotai sees a new
  reference.
- One-shot external event callbacks that must observe atom writes from the same
  React batch should read with the provider-bound `useStore().get(...)` instead
  of relying on a render-captured atom value.

## Cleanup

When deleting an entity, prune any keyed Jotai presentation state for that
entity. Chat state already uses helper atoms such as
`removeChatIdFromAllTrackingAtom`.

For provider-owned disposable services, keep constructors side-effect-free and
start external subscriptions only after the provider commits. React StrictMode
replays effect setup/cleanup while retaining hook state, so cleanup must not
permanently dispose an instance that the replayed setup will reuse.

## App run-state event identity

Proxy-ready output does not carry an operation generation. Stamping it with the
current run epoch does not prove it belongs to that run, so never use a buffered
proxy URL to override a failed destructive restart or reapply a potentially dead
proxy; require producer-side identity before treating it as current-run evidence.

## Preview runtime state is manager-owned, not Jotai

`src/atoms/previewRuntimeAtoms.ts` no longer exists — `currentAppUrlAtom` and
`appUrlByAppIdAtom` were replaced by snapshot stores read through
`@/hooks/useAppRun` (`useCurrentAppUrl`, `useAppRunState`, `useAppExit`,
`usePreviewReloadToken`), backed by the `AppRunRemoteProvider` manager. Read the
hook for the current app URL instead of reintroducing a Jotai projection; a
branch written before this migration will conflict on those imports.
