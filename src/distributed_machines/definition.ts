import type { IdSource } from "@/state_machines/clock";
import type { z } from "zod";
import type {
  CommandScheduler,
  DispatchTicket,
} from "@/state_machines/dispatcher";
import type { InvocationRef } from "@/state_machines/invocation_ref";
import type { TaskScope } from "@/state_machines/task_scope";
import type { TimerLeaseScope } from "@/state_machines/timer_lease";
import type {
  DispatchContext,
  IgnoreReason,
  TransitionObserver,
  TransitionResult,
} from "@/state_machines/types";
import type { RuntimeRemoteIntentContract } from "./remote_intent_contract";
import type { KeyedAdmissionGeneration } from "./keyed_admission_gate";
import type {
  OperationLookupIdentity,
  OperationReceiptMetadata,
  OperationRegistry,
} from "./operation_registry";

export type ActorInstanceId = string;

export interface ActorRuntimeMetadata {
  readonly actorInstanceId: ActorInstanceId;
  readonly snapshotRevision: number;
  readonly transactionSequence: number;
}

/** Correlates one domain invocation with the actor lifetime that owns it. */
export interface ActorInvocationIdentity<
  Kind extends string = string,
  EntityKey extends string | number = string | number,
> {
  readonly actor: ActorRuntimeMetadata;
  readonly invocation: InvocationRef<Kind, EntityKey>;
}

export interface MachineHostContext<Key, State, Event> {
  readonly key: Key;
  readonly actorInstanceId: ActorInstanceId;
  readonly ids: IdSource;
  readonly tasks: TaskScope<PropertyKey>;
  readonly timers: TimerLeaseScope<PropertyKey, unknown, Event>;
  /**
   * Factory-safe: reads the initial snapshot until construction completes.
   */
  getMetadata(): ActorRuntimeMetadata;
  getSnapshot(): State;
  /**
   * Factory-safe: events emitted during construction are drained after the
   * dispatcher and every definition callback are installed.
   */
  send(event: Event): void;
  /**
   * Captures a non-creating producer sink bound to this actor instance and the
   * current keyed admission generation.
   */
  captureSink(options?: {
    /**
     * Opt in only when every producer event carries domain correlation that
     * rejects stale work after unrelated collection revisions.
     */
    readonly revisionPolicy?: "captured" | "allow-advance";
  }): ActorEventSink<Event>;
}

export interface ActorEventSink<Event> {
  readonly actor: ActorRuntimeMetadata;
  readonly admissionGeneration: KeyedAdmissionGeneration;
  send(event: Event): void;
}

type OutcomePublisher<Outcome> = {
  bivarianceHack(outcome: Outcome): void;
}["bivarianceHack"];

type OutcomePublisherFactory<Key, State, Event, Outcome> = {
  bivarianceHack(
    context: MachineHostContext<Key, State, Event>,
  ): OutcomePublisher<Outcome>;
}["bivarianceHack"];

/**
 * A returned Promise must span the complete command continuation. Returning
 * void is retained for compatibility, but ActorHost must reject destructive
 * fencing if that legacy runner may have detached asynchronous work.
 */
export type CommandRunner<Command, Event> = (
  command: Command,
  emit: (event: Event) => void,
) => void | Promise<void>;

export interface ActorDisposalContext<Key, State> {
  readonly key: Key;
  readonly cause: ActorDisposalCause;
  readonly metadata: ActorRuntimeMetadata;
  readonly snapshot: State;
}

export type ActorDisposalCause =
  | "explicit"
  | "idle"
  | "terminal"
  | "entity-deletion"
  | "machine-disposal"
  | "shutdown";

export type ActorRetentionPolicy =
  | { readonly kind: "retain" }
  | { readonly kind: "dispose-after"; readonly delayMs: number };

export interface ActorLifecyclePolicy<Key, State> {
  readonly subscriptionCreates: boolean;
  readonly dispatchCreates: boolean;
  readonly idleEviction: ActorRetentionPolicy;
  readonly terminalRetention: ActorRetentionPolicy;
  readonly entityDeletion: "dispose" | "retain";
  readonly rendererOwnership: "host" | "window";
  readonly survivesRendererReload: boolean;
  readonly restartPersistence: "ephemeral" | "persistent";
  readonly flushOnShutdown: boolean;
  readonly isTerminal?: (state: State) => boolean;
  readonly settleWaiters?: (
    context: ActorDisposalContext<Key, State>,
  ) => void | Promise<void>;
  readonly projectTerminal?: (
    context: ActorDisposalContext<Key, State>,
  ) => void | Promise<void>;
  readonly flush?: (
    context: ActorDisposalContext<Key, State>,
  ) => void | Promise<void>;
  readonly onDisposed?: (
    context: ActorDisposalContext<Key, State>,
  ) => void | Promise<void>;
}

/**
 * Persistence is a definition-time contract only in B2. Hydration, adapters,
 * and storage execution are introduced with the persistence wave.
 */
export interface MachinePersistencePolicy<Key, State> {
  readonly version: number;
  readonly keyType?: Key;
  readonly stateType?: State;
}

/**
 * Remote transport is a definition-time contract only in B2. Codecs,
 * authorization, and transport execution are introduced in B3.
 */
export interface RemoteMachineSender {
  readonly webContentsId: number;
  readonly windowSessionId?: string;
}

export type RemoteRevisionPolicy = "allow-stale" | "reject-stale";

export interface RemoteMachineContract<
  Key,
  State,
  Event,
  RemoteState = unknown,
> {
  readonly protocolVersion: number;
  /**
   * Optional per-machine ceilings for validated wire envelopes. Machines with
   * intentionally large payloads may raise the defaults without weakening the
   * bound for every other remote machine.
   */
  readonly maxDispatchEnvelopeBytes?: number;
  readonly maxSnapshotEnvelopeBytes?: number;
  readonly keyCodec: z.ZodType<Key>;
  readonly encodeKey: (key: Key) => unknown;
  /**
   * Optionally replace an authorized decoded key with the host's canonical
   * identity key. This runs only after subscribe authorization succeeds, so
   * untrusted wire keys cannot populate process-lifetime identity caches.
   */
  readonly canonicalizeKeyAfterAuthorization?: (key: Key) => Key;
  readonly eventCodec: z.ZodType<Event>;
  readonly snapshotCodec: z.ZodType<RemoteState>;
  readonly keyToString: (key: Key) => string;
  readonly projectSnapshot: (
    state: State,
    key: Key,
    metadata: ActorRuntimeMetadata,
  ) => RemoteState;
  /**
   * Explicit non-authoritative renderer view used before bootstrap, after
   * disposal, and while the transport is unavailable.
   */
  readonly unavailableSnapshot: (key: Key) => RemoteState;
  readonly revisionPolicy: (event: Event) => RemoteRevisionPolicy;
  /** Throw DyadErrorKind.Auth for an expected access denial. */
  readonly authorizeSubscribe: (context: {
    readonly sender: RemoteMachineSender;
    readonly key: Key;
  }) => void | Promise<void>;
  /** Throw DyadErrorKind.Auth for an expected access denial. */
  readonly authorizeDispatch: (context: {
    readonly sender: RemoteMachineSender;
    readonly key: Key;
    readonly event: Event;
    readonly currentState: State | undefined;
  }) => void | Promise<void>;
}

export interface RemoteOperationContract<
  Key,
  RemoteIntent,
  Event,
  DomainOutcome,
  OperationInvocationRef extends InvocationRef,
> {
  prepare(context: {
    readonly key: Key;
    readonly intent: RemoteIntent;
    readonly event: Event;
    readonly sender: Required<Pick<RemoteMachineSender, "windowSessionId">>;
    readonly actor: ActorRuntimeMetadata;
    readonly hostId: string;
    readonly fingerprint: string;
  }):
    | {
        readonly registry: OperationRegistry<
          DomainOutcome,
          OperationInvocationRef
        >;
        readonly identity: OperationLookupIdentity;
        readonly createInvocationRef: () => OperationInvocationRef;
      }
    | undefined;
  ignoredOutcome(reason: string): DomainOutcome;
  receipt(actor: ActorRuntimeMetadata): OperationReceiptMetadata;
  releaseManager?(): number;
}

export interface DistributedMachineDefinition<
  Id extends string,
  Key,
  State,
  Event,
  Command,
  Reason extends IgnoreReason,
  RemoteIntent = Event,
  Outcome = never,
> {
  readonly id: Id;
  readonly host: "main" | "renderer";
  readonly initialState: (key: Key) => State;
  readonly transition: (
    state: State,
    event: Event,
    key: Key,
  ) => TransitionResult<State, Command, Reason, Outcome>;
  readonly createScheduler: (key: Key) => CommandScheduler<Command>;
  readonly createCommandRunner: (
    context: MachineHostContext<Key, State, Event>,
  ) => CommandRunner<Command, Event>;
  /**
   * Narrow hook for cancelling leases owned by the state being exited.
   * It runs after validation/reservation and before the snapshot commit.
   */
  readonly createBeforeCommit?: (
    context: MachineHostContext<Key, State, Event>,
  ) => (previous: State, next: State) => void;
  readonly createObserver?: (
    context: MachineHostContext<Key, State, Event>,
  ) => TransitionObserver<State, Event, Command, Reason>;
  /**
   * Optional authoritative post-commit outcome sink. ActorHost invokes it only
   * after the new snapshot is committed; failures are isolated by dispatcher.
   */
  readonly createOutcomePublisher?: OutcomePublisherFactory<
    Key,
    State,
    Event,
    Outcome
  >;
  readonly lifecycle: ActorLifecyclePolicy<Key, State>;
  readonly persistence?: MachinePersistencePolicy<Key, State>;
  readonly remote?: RemoteMachineContract<Key, State, Event>;
  /**
   * Native renderer-intent boundary. Definitions without this field use the
   * explicit protocol-v1 compatibility adapter in the remote transport.
   */
  readonly remoteIntent?: RuntimeRemoteIntentContract<
    Key,
    State,
    Extract<RemoteIntent, { readonly type: string }>,
    Event,
    unknown
  >;
  /** Optional completion-aware admission for declared request intents. */
  readonly remoteOperation?: RemoteOperationContract<
    Key,
    Extract<RemoteIntent, { readonly type: string }>,
    Event,
    any,
    any
  >;
}

export interface LocalActorRef<State, Event> {
  readonly kind: "local";
  readonly actorInstanceId: ActorInstanceId;
  getSnapshot(): State;
  getMetadata(): ActorRuntimeMetadata;
  subscribe(listener: () => void): () => void;
  send(event: Event, dispatchContext?: DispatchContext): void;
}

export interface HostedActorRef<
  State,
  Event,
  Reason extends IgnoreReason,
> extends LocalActorRef<State, Event> {
  /**
   * Captures a non-creating producer sink bound to this actor instance and
   * admission generation.
   */
  captureSink(): ActorEventSink<Event>;
  /**
   * Enrolls external work under a captured actor/gate lifetime so destructive
   * fences wait for the full continuation.
   */
  trackCaptured<Result>(
    sink: ActorEventSink<Event>,
    start: () => Promise<Result>,
  ): Promise<Result>;
  enqueue(
    event: Event,
    dispatchContext?: DispatchContext,
  ): ActorDispatchTicket<State, Reason>;
}

export interface ActorDispatchTicket<
  State,
  Reason extends IgnoreReason,
> extends DispatchTicket<State, Reason> {
  getSettledMetadata(): ActorRuntimeMetadata | undefined;
}
