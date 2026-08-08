# Sandbox Gaps

> Remaining gaps in the current cloud sandbox implementation as of 2026-03-13

This document records what still looks meaningfully incomplete after wiring full-app snapshot sync, version restore/checkout sync, cloud restart behavior for AI edits, and startup reconciliation.

## 1. Env var changes still do not guarantee a cloud process restart

`.env.local` and related env writes now trigger a cloud snapshot sync, but they do not force a cloud app restart.

That means:

- file contents in the remote sandbox update
- the already-running cloud process may still keep old environment values

For env changes, “snapshot synced” is not the same as “runtime config applied”.

## 2. Interactive prompt handling is still unsupported in cloud mode

`respondToAppInput` still assumes a local process with `stdin`.

For cloud sandboxes:

- there is no stdin bridge
- cloud log streaming is not translated into Dyad `input-requested` events

Any remote process that asks an interactive question will still not participate correctly in the existing prompt/response UX.

## 3. Engine-side lifecycle policy is still thin

Desktop now uses a 10-minute idle GC to match local behavior, and it can ask the engine to reconcile stale sandboxes on startup.

What still does not exist on the engine contract side:

- real concurrent sandbox enforcement
- authoritative idle expiry / hibernation semantics
- richer sandbox state transitions
- structured ownership / quota enforcement

So the desktop flow works, but lifecycle policy is still mostly client-driven.

## 4. Quit/crash cleanup still depends on later reconciliation

Normal stop/restart paths now destroy cloud sandboxes, but crash/forced-quit cases can still orphan them until reconciliation runs.

That is acceptable as a fallback, but it is still weaker than server-enforced expiry and ownership cleanup.

## 5. Address bar path still reflects the proxy URL

The preview toolbar still derives the displayed path from the proxied iframe URL, not from the canonical direct sandbox URL.

So the current UI still leaks proxy routing details rather than showing the pure sandbox path model from the original plan.

## 6. Cloud-specific error and loading UX is still minimal

The current UI has:

- cloud runtime selection
- cloud badge
- shareable link copy

It still lacks dedicated UX for:

- provisioning phases
- timeout/auth/quota failures
- reconcile/cleanup notifications
- better cloud-specific recovery actions

## 7. Provider contract is still too minimal for production

The current desktop-side provider contract is basically:

- create
- upload full snapshot
- stream logs
- destroy
- reconcile

Still likely missing for production use:

- structured error codes
- sandbox status inspection
- explicit restart / hibernate / wake operations
- env-specific mutation semantics
- better metadata for ownership and auditing

## 8. Local `appPath` is still sent to the engine

The create request still sends the local absolute app path.

That is not required for the general remote execution model and leaks local machine structure unnecessarily.

## 9. Coverage is still not broad enough

Coverage is better now. There is cloud E2E coverage for:

- shareable link
- remote snapshot change after AI edits
- undo causing the remote snapshot to change

Still missing targeted coverage for:

- version checkout / version pane flows in cloud mode
- env var changes in cloud mode
- visual editing sync in cloud mode
- local agent file-tool sync in cloud mode
- startup reconciliation behavior
- cloud-specific error states

## Recommended follow-up order

1. Force a cloud restart after env var writes, or add a real engine-side env update primitive.
2. Decide the engine-side lifecycle contract for quotas, idle expiry, and hibernation.
3. Add a cloud stdin/input-request bridge if interactive apps matter.
4. Add structured cloud error codes and map them to dedicated UI states.
5. Expand E2E coverage for the remaining cloud-specific workflows.
