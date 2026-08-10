# App operation coordination

Use `appOperationCoordinator` for main-process operations that need exclusion
against other work on the same app. Declare only the resources the operation
actually touches; never use a raw numeric `appId` with `withLock`.

## Resource domains

| Resource          | Protects                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app-path`        | The app row's path and directory identity. Path consumers take read access; rename, relocation, template path swaps, and deletion take write access. |
| `chat-content`    | Destructive chat/message mutations.                                                                                                                  |
| `chat-membership` | Chat creation and app-deletion child snapshots.                                                                                                      |
| `media`           | Files in the app media collection.                                                                                                                   |
| `metadata`        | Read-modify-write app metadata fields.                                                                                                               |
| `provider`        | Neon/Supabase associations and provider lifecycle state.                                                                                             |
| `repository`      | Git HEAD, refs, index, and working-tree mutations. Read access is sufficient for a stable snapshot such as a new chat's initial commit.              |
| `runtime`         | Process, proxy, port, and sandbox lifecycle.                                                                                                         |
| `runtime-config`  | Environment/configuration consumed when starting the runtime. Runtime lifecycle reads it; test/provider environment swaps write it.                  |
| `test-files`      | Test execution inputs and test artifact mutations.                                                                                                   |

For one app, operations acquire all resources atomically, so callers must
declare the full set up front rather than nesting another operation for that
app. Cross-app operations may compose per-app acquisitions only in ascending
numeric app-ID order, after deduplicating the IDs, so every caller uses the
same global order. Use direct unlocked service primitives only when the outer
operation already owns the required resources, and document that ownership at
the call site.

App deletion closes coordinator admission before draining admitted work. Every
new app-scoped main-process mutation must therefore use the coordinator unless
it is already owned and drained by a domain-specific actor fence. Deletion-only
work uses the opaque deletion handle after `drain()`; ordinary handlers must
never bypass admission.

For runtime start/restart, spawning the long-lived install/dev child is not the
end of startup. Retain path, repository, and runtime-config admission until the
preview is ready so install and self-heal work cannot race Git mutations. Any
later background callback that writes the working tree must acquire its own
coordinator operation.

Keep `withLock` for non-app string identities such as canonical file paths and
token refreshes. Its string-only signature intentionally prevents the old
global `withLock(appId, ...)` pattern from returning.

## Sessions that hold claims for a user-controlled duration

A recording session holds `repository`, `provider`, `runtime`, `runtime-config`
and `test-files` until the user ends it (capped at 30 minutes), and the
coordinator queues conflicting work with **no timeout** — read-vs-write counts
as a conflict. So every handler taking one of those resources becomes an
indefinite spinner with nothing on screen explaining it. Each such path must
either end the session (`endRecordingForApp`, for Stop/Run/Restart/Delete, which
own the app going away) or refuse with `assertNoActiveRecording(appId, action)`
when the session is the thing the user is doing. Adding a resource to a
long-lived operation means auditing every other handler that declares it.

Reserve the session's app **before the handler's first await** and give the
reservation a main-owned cancellation tombstone, not just a busy flag. Between
the reservation and the published handle there is nothing for a concurrent
teardown to stop, so it reports success while the reserved start goes on to swap
`.env.local` and restart the dev server the caller was stopping. The start has to
re-read the tombstone after every setup await, and release must be
identity-checked so a cancelled attempt cannot retire its successor's
reservation. Same rule as the main-owned tombstone in
[rules/state-machines.md](state-machines.md), applied main-to-main.
