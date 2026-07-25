# App-run wire codecs and safe remote projection

Status: accepted for C1.2; the contracts ship dark and C1.3 owns wiring.

## Boundary and event split

`src/app_run/transport.ts` defines two closed, strict allowlists. Renderer
dispatch may decode only `AppRunIntentEventSchema`; trusted main-process
adapters may decode `AppRunProducerEventSchema`. Unknown event kinds and
unknown payload fields fail decoding. The combined schema exists for tests and
transport-neutral tooling, not as permission to dispatch producer events from
a renderer.

Remote intents carry an immutable `operationId` and `startedAt`. START and
RESTART are state-sensitive and require `expectedRevision`. STOP_REQUESTED is
cancellation: its request `operationId` is distinct from, and cannot replace,
the required `activeInvocationRef`. MANUAL_RELOAD is idempotent/current-
agnostic. There is no presentation-only member of the current `RunEvent`
union; `applyUrl` and reload-token commands become typed post-commit
presentation consumers in C1.3 rather than a second domain mutation path.

Every current event has an explicit refined destination:

| Current `RunEvent` | Refined wire event             | Admission                                       |
| ------------------ | ------------------------------ | ----------------------------------------------- |
| START              | START                          | state-sensitive intent                          |
| RESTART            | RESTART (`operation: restart`) | state-sensitive intent                          |
| REBUILD            | RESTART (`operation: rebuild`) | state-sensitive intent                          |
| STOP               | STOP_REQUESTED                 | cancellation intent; active invocation required |
| MANUAL_RELOAD      | MANUAL_RELOAD                  | idempotent intent                               |
| EXTERNAL_RESTART   | EXTERNAL_RESTART_STARTED       | host-only producer admission                    |
| RUN_IPC_RESOLVED   | PROCESS_SPAWNED                | host-only settlement                            |
| RUN_IPC_FAILED     | PROCESS_FAILED                 | host-only settlement                            |
| STOP_IPC_RESOLVED  | PROCESS_STOPPED                | host-only settlement                            |
| STOP_IPC_FAILED    | PROCESS_STOP_FAILED            | host-only settlement                            |
| PROXY_READY        | PROXY_READY                    | host-only producer                              |
| HMR_DETECTED       | HMR_DETECTED                   | host-only producer                              |
| RELOAD_DONE        | RELOAD_COMPLETED               | host-only settlement                            |
| APP_EXIT           | PROCESS_EXITED                 | host-only producer                              |

The spawn result remains distinct from PROXY_READY. A proxy URL may arrive
first and is buffered in `RunState.pendingUrl`; PROCESS_SPAWNED later commits
ready state and exposes it. Combining those events would change behavior.
HMR_DETECTED is the one refinement that needs producer work in C1.3: current
log parsing supplies only `appId`, so the main producer must attach the active
invocation ref at capture time. Ref-less legacy producer compatibility is not
part of the new allowlist, as decided by B0.

## Safe remote read model

`projectAppRunRemoteSnapshot(appId, revision, state)` maps authoritative
`RunState` into:

- phase and actor revision;
- in-flight operation and `startedAt` where the current state retains them;
- safe URL/original URL/runtime mode;
- operation error or process-exit details;
- named UI capabilities; and
- the active/last invocation ref needed for diagnostics and targeted stop.

Idle has no invocation. Starting exposes its operation and timestamp but not a
buffered `pendingUrl`; that URL becomes public only after spawn settlement.
Ready and reloading expose their URL. Reloading reports operation `reload`,
while stopped exposes its nullable exit code and timestamp. Errored exposes
only the operation error. The existing state does not retain the initiating
operation or timestamp after settlement, so those fields are null in ready,
stopped, and errored unless C1.3 deliberately enriches the authoritative
state.

The projection explicitly excludes child-process/process handles, internal
paths (app path, cwd, executable paths), command/runtime data, producer
callbacks, and renderer callback registries. All schemas accept JSON data
only: no callbacks, Error instances, Maps/Sets without an explicit encoding,
or resource handles cross the wire. Strict rejection tests and a compile-time
excluded-key assertion guard that boundary.

## C1.3 consumption and cutover questions

C1.3 registers the key, intent, producer, and snapshot schemas with the main
actor definition; translates accepted intents into the existing transition
semantics; binds runtime producers to invocation refs; and publishes this
projection after authoritative commits. The generic actor envelope owns
revision/receipt/subscription mechanics, while this module owns domain payload
validation.

Open cutover questions are limited to integration choices:

1. Whether accepted intent `operationId` is reused as the main invocation
   operation ID or remains a distinct idempotency identity while main mints
   correlation identity, preserving B0's authoritative mint boundary.
2. Whether ready/errored snapshots need the initiating operation and
   `startedAt`; supporting that requires enriching `RunState`, not inferring
   identity from timestamps.
3. Which main output adapter attaches the active invocation to legacy
   HMR-shaped log lines before the ref-less compatibility path is removed.
