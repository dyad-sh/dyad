import type { IdSource } from "@/state_machines/clock";
import type {
  CommandScheduler,
  DispatchTicket,
} from "@/state_machines/dispatcher";
import type { InvocationRef } from "@/state_machines/invocation_ref";
import type { TaskScope } from "@/state_machines/task_scope";
import type { TimerLeaseScope } from "@/state_machines/timer_lease";
import type {
  IgnoreReason,
  TransitionObserver,
  TransitionResult,
} from "@/state_machines/types";

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
}

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
export interface RemoteMachineContract<Key, State, Event> {
  readonly protocolVersion: number;
  readonly keyType?: Key;
  readonly stateType?: State;
  readonly eventType?: Event;
}

export interface DistributedMachineDefinition<
  Id extends string,
  Key,
  State,
  Event,
  Command,
  Reason extends IgnoreReason,
> {
  readonly id: Id;
  readonly host: "main" | "renderer";
  readonly initialState: (key: Key) => State;
  readonly transition: (
    state: State,
    event: Event,
  ) => TransitionResult<State, Command, Reason>;
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
  readonly lifecycle: ActorLifecyclePolicy<Key, State>;
  readonly persistence?: MachinePersistencePolicy<Key, State>;
  readonly remote?: RemoteMachineContract<Key, State, Event>;
}

export interface LocalActorRef<State, Event> {
  readonly kind: "local";
  readonly actorInstanceId: ActorInstanceId;
  getSnapshot(): State;
  getMetadata(): ActorRuntimeMetadata;
  subscribe(listener: () => void): () => void;
  send(event: Event): void;
}

export interface HostedActorRef<
  State,
  Event,
  Reason extends IgnoreReason,
> extends LocalActorRef<State, Event> {
  enqueue(event: Event): DispatchTicket<State, Reason>;
}
