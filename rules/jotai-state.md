# Jotai State Ownership

Use Jotai for client-only state, not as a second cache for IPC data.

## No root Provider: production uses the default store

The renderer mounts no root Jotai `<Provider>`, so production components and
`useStore()` resolve to jotai's default store, while tests wrap components in
`<Provider store={createStore()}>`. Module-scope services that read/write
atoms outside React (e.g. the version preview command adapter in
`src/version_preview/commands.ts`) must receive the store from `useStore()`
at initialization instead of importing `getDefaultStore()`, or test stores
will silently diverge from the store the service writes to.

## Version preview state is machine-owned

Git preview orchestration and its ephemeral presentation selection live in
the app-keyed state machine under `src/version_preview/`. Never add a parallel
Jotai atom for the selected version, diff file, return branch, or mutation
status; read the machine snapshot and send events through
`useVersionPreview(appId)`. The command adapter is the only renderer caller of
version-mutation IPC (see `plans/better-state-machine.md`).

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
- Jotai owns client-only UI/runtime state that must survive component unmounts:
  selected UI modes, queues, in-flight streaming state, optimistic chat state,
  preview runtime state, and transient UI state shared across distant
  components.
- React local state owns form fields, modal visibility, measurement, and state
  used by a single component subtree.

## Entity Scoping

When state belongs to an entity, key it by that entity id instead of using a
singleton selected-entity value.

Good examples:

```ts
chatMessagesByIdAtom: Map<number, Message[]>;
isStreamingByIdAtom: Map<number, boolean>;
previewRunStateByAppIdAtom: Map<number, PreviewRunState>;
```

Avoid unkeyed global booleans for entity-specific async work. A value like
`loading: boolean` is only safe when exactly one operation can own it. Prefer
an app/chat/job keyed map and derive the currently visible value from the
selected id.

## Derived Atoms

Expose derived atoms or domain hooks for "current selected" reads:

```ts
currentPreviewErrorAtom = atom((get) => {
  const appId = get(selectedAppIdAtom);
  return appId == null ? undefined : get(previewErrorByAppIdAtom).get(appId);
});
```

Components should usually read `currentPreviewErrorAtom` rather than repeat
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

## Cleanup

When deleting an entity, prune any keyed Jotai state for that entity. Chat
state already uses helper atoms such as `removeChatIdFromAllTrackingAtom`; app
scoped runtime state should follow the same pattern.

For provider-owned disposable services, keep constructors side-effect-free and
start external subscriptions only after the provider commits. React StrictMode
replays effect setup/cleanup while retaining hook state, so cleanup must not
permanently dispose an instance that the replayed setup will reuse.

## App run-state event identity

Proxy-ready output does not carry an operation generation. Stamping it with the
current run epoch does not prove it belongs to that run, so never use a buffered
proxy URL to override a failed destructive restart or reapply a potentially dead
proxy; require producer-side identity before treating it as current-run evidence.
