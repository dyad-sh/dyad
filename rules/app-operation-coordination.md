# App operation coordination

Use `appOperationCoordinator` for main-process operations that need exclusion
against other work on the same app. Declare only the resources the operation
actually touches; never use a raw numeric `appId` with `withLock`.

## Resource domains

| Resource              | Protects                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app-path`            | The app row's path and directory identity. Path consumers take read access; rename, relocation, template path swaps, and deletion take write access.          |
| `chat-content`        | Destructive chat/message mutations.                                                                                                                           |
| `chat-membership`     | Chat creation and app-deletion child snapshots.                                                                                                               |
| `media`               | Files in the app media collection.                                                                                                                            |
| `metadata`            | Read-modify-write app metadata fields.                                                                                                                        |
| `provider`            | Neon/Supabase associations and provider lifecycle state.                                                                                                      |
| `repository`          | Umbrella claim for both repository subresources below. Existing general repository operations should keep using it.                                           |
| `repository-ref`      | Git HEAD and refs. A read captures a stable commit without excluding a working-tree-only session such as E2E execution or recording.                          |
| `repository-worktree` | Git index and working-tree files. Test and recording sessions write this while reading `repository-ref`, keeping code stable without blocking HEAD snapshots. |
| `runtime`             | Process, proxy, port, and sandbox lifecycle.                                                                                                                  |
| `runtime-config`      | Environment/configuration consumed when starting the runtime. Runtime lifecycle reads it; test/provider environment swaps write it.                           |
| `test-files`          | Test execution inputs and test artifact mutations.                                                                                                            |

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

Chat deletion must start `userInputRegistry.settleChat(chatId)` before closing
chat-actor admission. Otherwise an already-due follow-up can observe the fence
and settle as rejected instead of swept. In that same synchronous turn, close
sub-agent admission with `blockSubagentAdmissionsForChat(chatId)` before the
first await, then hold both the sub-agent settlement release and admission
release until the destructive mutation commits or aborts.

For runtime start/restart, spawning the long-lived install/dev child is not the
end of startup. Retain path, repository, and runtime-config admission until the
preview is ready so install and self-heal work cannot race Git mutations. Any
later background callback that writes the working tree must acquire its own
coordinator operation.

Keep `withLock` for non-app string identities such as canonical file paths and
token refreshes. Its string-only signature intentionally prevents the old
global `withLock(appId, ...)` pattern from returning.

## Sessions that hold claims for a user-controlled duration

A recording session holds `repository-worktree`, `provider`, `runtime`,
`runtime-config` and `test-files` until the user ends it (capped at 30 minutes),
while retaining read access to `repository-ref`. The
coordinator queues conflicting work with **no timeout** — read-vs-write counts
as a conflict. So every handler taking one of those resources becomes an
indefinite spinner with nothing on screen explaining it. Each such path must
either end the session (`endRecordingForApp`, for Stop/Run/Restart/Delete, which
own the app going away) or refuse when the session is the thing the user is
doing. Adding a resource to a long-lived operation means auditing every other
handler that declares it.

Test runs and recordings set `allowCompatibleQueueBypass` because an ordinary
repository writer can queue behind their working-tree claim and would otherwise
become a fairness barrier for later ref-only snapshots such as New Chat. Use
this flag only on a long-lived owner: bypass is allowed only while every direct
blocker of the queued operation opts in and the later operation is compatible
with those blockers. Normal writer fairness resumes when the owner releases.

For cross-app operations, apply recording refusal per app according to that
app's claims, not to the whole operation indiscriminately. For example, moving
media claims `media` on both apps but `repository` only on the target (where it
may update `.gitignore`), so a recording target must refuse while a recording
source can still move the media out.

Refuse by passing `refuseWhenRecording: "<action>"` on the coordinator request,
not by calling `assertNoActiveRecording` beforehand. `run()` checks it in the
same synchronous step as the enqueue, so no session can start in between; a
caller-side check leaves exactly that window, and the operation then queues
behind the session the check existed to avoid. Keep a separate preflight only
where one must precede work the admission cannot cover (`copyApp` recovers a
prior test branch first), and pass the flag as well.

When refusing arrives too late to be free — `restoreToMessage` cancels the
user's in-flight generations before it can take the repository claim — take
`blockRecordingStart(appId, reason)` first and release it in the same `finally`
as the other admission blocks. Refusing after a destructive step costs the user
both the generation and the operation.

Reserve the session's app **before the handler's first await** and give the
reservation a main-owned cancellation tombstone, not just a busy flag. Between
the reservation and the published handle there is nothing for a concurrent
teardown to stop, so it reports success while the reserved start goes on to swap
`.env.local` and restart the dev server the caller was stopping. The start has to
re-read the tombstone after every setup await, and release must be
identity-checked so a cancelled attempt cannot retire its successor's
reservation. Same rule as the main-owned tombstone in
[rules/state-machines.md](state-machines.md), applied main-to-main.

## A deliberate stop looks like a crash to the process close listener

`stopAppByInfo` awaits `killProcess` and only deletes the `runningApps` entry
after it resolves, but the child's spawn-time `close` listener runs _first_ and
synchronously reaches `removeAppIfCurrentProcess` with the entry still current.
Anything that listener treats as "the app went away on its own" therefore fires
for intentional restarts too. Isolation setup restarts the very app it is
preparing to record, so an unmarked restart ended the session it was setting up
and deleted the temporary Neon branch ~200ms after creating it. Mark such stops
(`stopAppByInfo(appId, appInfo, { recordingOwnedRestart: true })`) rather than
assuming map-entry ordering distinguishes them.
