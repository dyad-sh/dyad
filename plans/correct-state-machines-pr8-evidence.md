# PR8 image-generation pilot evidence

## Named baseline

`PR8-B0` is the image-generation inventory at PR6 commit
`e3703a162543878f6abd4bd38d9978f7124ba3ba`, before this migration.

| Boundary                       | PR8-B0 inventory                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Admission and mutation glue    | `useGenerateImage.start` and `.cancel` each read and call raw `remote.dispatch` (four semantic boundary entries); enqueue receipt was treated as the public start result |
| Subscription/ref-counting glue | No image-specific registry; renderer used the shared distributed-machine subscription                                                                                    |
| Promise/waiter registries      | `ImageGenerationService.active` retained provider promises and abort controllers; there was no authoritative request-completion registry                                 |
| Effect callback correlation    | `createCommandRunner` detached a `generate(...).then(success, failure)` callback; correlation depended on the job invocation captured by that callback                   |
| Deletion/cancellation guards   | `ImageGenerationService.deletionFences`, `resetFenceCount`, `begin/endAppDeletion`, `begin/endReset`, plus cancellation by provider request ID                           |
| Form/dialog reset logic        | `ImageGeneratorDialog` reset prompt/theme/target on accepted close and closed when `start()` returned a job ID; correctness depended on `start()` meaning admission      |
| Raw dispatch call sites        | Two renderer calls, represented by four access/call inventory entries in `boundary_inventory.test_support.ts`                                                            |
| Initiator routing              | Presentation stored job-to-window routes but could fall back to an unrelated visible window                                                                              |
| Terminal retention             | Terminal actor jobs retained for 30 minutes; no bounded authoritative completion payload store                                                                           |

## Post-migration inventory

`PR8-P1` is the inventory on
`refactor/image-generation-operation-settlement`.

| Boundary                       | PR8-P1 inventory                                                                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admission and mutation glue    | Public `useGenerateImage` uses two shared `useMachineMutation` instances and completion-aware `request()`; admission and settlement are separate                                         |
| Subscription/ref-counting glue | Each prepared request owns a `RemoteSubscriptionLease`; release is tied to authoritative settlement, refusal, or failure                                                                 |
| Promise/waiter registries      | One authoritative `OperationRegistry` (64 unresolved, 128 retained terminal payloads); no image-specific promise/waiter map was added                                                    |
| Effect callback correlation    | One exhaustive `GenerateImage` handler in the reusable one-shot handler map; every accepted effect emits one correlated terminal event                                                   |
| Deletion/cancellation guards   | The actor key uses `KeyedAdmissionGate` through destructive commit; the provider service keeps its app/reset fences as a non-actor resource barrier and aborts provider work             |
| Form/dialog reset logic        | Existing accepted-close behavior is unchanged, but `start()` returns a job ID only after authoritative admission; refusal/transport failure returns `null`, preserving prompt and dialog |
| Raw dispatch call sites        | Zero in the public hook/component façade. Two calls remain inside `useImageGenerationRequestActor.dispatchRequest`, the explicit completion-aware protocol-v1 adapter                    |
| Initiator routing              | Presentation is sent only to the captured initiating window session; no generic route registry or unrelated-window fallback                                                              |
| Terminal retention             | Actor projections retain terminal jobs for 30 minutes; authoritative outcomes retain at most 128 settled payloads, independently of the 64 pending-operation capacity                    |

## Policy and identity notes

- Concurrency is explicitly parallel and bounded by the operation registry's
  64 unresolved-operation capacity. Jobs remain a collection keyed by job ID;
  each logical request and runtime invocation settles independently.
- Logical request ID, job ID, runtime operation ID, delivery message ID,
  actor instance/revision, window session, and observed renderer revision remain
  separate values.
- Duplicate output for the same runtime identity cannot overwrite its first
  terminal payload. Output from an older runtime identity cannot settle a
  replacement.
- Cancellation is a typed `cancelled` outcome. Actor, machine, host, and
  app-deletion disposal use typed `disposed` outcomes; manager teardown uses
  the owning host disposal cause. Renderer/window release detaches observation
  but does not replace a host-owned terminal outcome.
- The app-deletion fence is published synchronously, permits only declared
  cancellation/terminal cleanup while draining, seals before database deletion,
  commits through the destructive transaction, and aborts only through the
  generation-bound handle on failure. App deletions use an explicit global
  queue because the image operation collection has one global actor key.

## Compatibility, rollback, and escape hatches

- Existing image-generation renderer hooks/components, presentation events,
  distributed-machine protocol version, and image provider behavior are
  preserved. The operation wait IPC is additive.
- The protocol-v1 event codec remains the rollback boundary; removing
  `remoteOperation`, the operation wait handler, and the request adapter restores
  the PR6 transport shape without data migration.
- Two protocol-v1 adapter dispatch calls remain because PR6 intentionally
  exposes `createCompletionAwareActor` as the raw-dispatch compatibility
  boundary. They are inventoried and do not leak into migrated mutations.
- Provider-level deletion/reset counters remain because the provider owns
  database/filesystem work outside the actor host. The authoritative actor
  admission boundary is nevertheless the keyed gate.
- The global image-job collection exposes a framework limitation for
  app-scoped destruction: its keyed fence must drain the whole actor before
  sealing, so deleting one app waits for unrelated in-flight image jobs and
  temporarily blocks collection-wide submission. Safely preserving unrelated
  generations requires app-partitioned actor keys or scoped gate generations;
  PR8 does not conceal that broader framework change in domain lifecycle glue.
- The pilot found and closed a framework gap: image-generation producer sinks
  need to survive unrelated collection revisions. Captured sinks remain
  revision-bound by default; this pilot explicitly opts into actor-instance plus
  keyed-admission-generation binding, while job/runtime identity rejects stale
  output.
- No `OperationRouteRegistry`, saga/workflow layer, generated binding, protocol
  envelope change, persistence, or app-run migration was introduced.
