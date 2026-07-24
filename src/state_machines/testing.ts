import type { IgnoreReason, TransitionResult } from "./types";
import type { Clock, ClockHandle, IdSource } from "./clock";
import { KeyedControllerHost } from "./keyed_host";
import type { ReplaySerialization, ReplayTrace } from "./trace";
import {
  describeTransitionValue as describe,
  transitionValuesAreEqual as valuesAreEqual,
  validateTransitionResult,
} from "./transition_validation";

export { validateTransitionResult } from "./transition_validation";

export interface FakeClock extends Clock {
  advanceBy(delayMs: number): void;
  pendingTimerCount(): number;
}

/** Deterministic scheduler that runs due callbacks in deadline/creation order. */
export function createFakeClock(startAt = 0): FakeClock {
  let currentTime = startAt;
  let nextHandle = 1;
  const timers = new Map<
    number,
    { callback: () => void; deadline: number; order: number }
  >();

  return {
    now: () => currentTime,
    schedule(callback, delayMs) {
      const handle = nextHandle++;
      timers.set(handle, {
        callback,
        deadline: currentTime + Math.max(0, delayMs),
        order: handle,
      });
      return handle as unknown as ClockHandle;
    },
    cancel(handle) {
      timers.delete(handle as unknown as number);
    },
    advanceBy(delayMs) {
      if (delayMs < 0) throw new Error("Fake clock cannot move backwards");
      const target = currentTime + delayMs;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.deadline <= target)
          .sort(
            ([, left], [, right]) =>
              left.deadline - right.deadline || left.order - right.order,
          )[0];
        if (!due) break;
        const [handle, timer] = due;
        timers.delete(handle);
        currentTime = timer.deadline;
        timer.callback();
      }
      currentTime = target;
    },
    pendingTimerCount: () => timers.size,
  };
}

export function createSequentialIdSource(startAt = 1): IdSource {
  let nextId = startAt;
  return {
    next(prefix) {
      return `${prefix}:${nextId++}`;
    },
  };
}

export interface CapabilityRepresentativeEvents<Event, Reason> {
  /** Valid payloads that must apply whenever the capability is enabled. */
  readonly valid: readonly Event[];
  /**
   * Invalid payloads whose rejection is independent of whether the control is
   * enabled. Omit them for states where another guard takes precedence.
   */
  readonly invalid?: readonly {
    readonly event: Event;
    readonly reason: Reason;
  }[];
}

export interface CapabilityConsistencyCase<State, Event, Reason> {
  readonly representativeEvents: (
    state: State,
  ) => CapabilityRepresentativeEvents<Event, Reason>;
  /**
   * When supplied, valid payloads for disabled states must be ignored for this
   * reason. Return undefined when the domain does not promise a reason for a
   * particular disabled state.
   */
  readonly disabledReason?: Reason | ((state: State) => Reason | undefined);
}

/**
 * Checks that explicit UI capability policy stays consistent with the real
 * transition function. Capability policy remains domain-owned: this helper
 * never probes synthetic events to derive it.
 */
export function assertCapabilityTransitionConsistency<
  State,
  Event,
  Command,
  Reason extends IgnoreReason,
  Capabilities extends {
    readonly [Capability in keyof Capabilities]: boolean;
  },
>(options: {
  states: readonly State[];
  selectCapabilities: (state: State) => Capabilities;
  transition: (
    state: State,
    event: Event,
  ) => TransitionResult<State, Command, Reason>;
  cases: {
    readonly [Capability in keyof Capabilities]: CapabilityConsistencyCase<
      State,
      Event,
      Reason
    >;
  };
}): void {
  for (const state of options.states) {
    const capabilities = options.selectCapabilities(state);
    for (const capability of Object.keys(
      capabilities,
    ) as (keyof Capabilities)[]) {
      const capabilityCase = options.cases[capability];
      const representatives = capabilityCase.representativeEvents(state);

      if (capabilities[capability] && representatives.valid.length === 0) {
        capabilityFailure(
          capability,
          "enabled capability must supply at least one representative valid event",
          state,
          undefined,
          undefined,
        );
      }

      for (const event of representatives.valid) {
        const result = options.transition(state, event);
        if (capabilities[capability]) {
          if (result.kind !== "applied") {
            capabilityFailure(
              capability,
              "enabled capability must apply its representative valid event",
              state,
              event,
              result,
            );
          }
          continue;
        }

        const disabledReason =
          typeof capabilityCase.disabledReason === "function"
            ? capabilityCase.disabledReason(state)
            : capabilityCase.disabledReason;
        if (disabledReason !== undefined) {
          if (result.kind !== "ignored" || result.reason !== disabledReason) {
            capabilityFailure(
              capability,
              `disabled capability must be ignored with reason ${describe(disabledReason)}`,
              state,
              event,
              result,
            );
          }
        }
      }

      for (const invalid of representatives.invalid ?? []) {
        const result = options.transition(state, invalid.event);
        if (result.kind !== "ignored" || result.reason !== invalid.reason) {
          capabilityFailure(
            capability,
            `invalid representative payload must be ignored with reason ${describe(invalid.reason)}`,
            state,
            invalid.event,
            result,
          );
        }
      }
    }
  }
}

function capabilityFailure(
  capability: PropertyKey,
  message: string,
  state: unknown,
  event: unknown,
  result: unknown,
): never {
  throw new Error(
    `Capability ${String(capability)}: ${message}\nSource state: ${describe(state)}\nEvent: ${describe(event)}\nResult: ${describe(result)}`,
  );
}

export function driveTransitionMatrix<
  State,
  Event,
  Command,
  Reason extends IgnoreReason = IgnoreReason,
>(options: {
  states: readonly State[];
  events: readonly Event[];
  transition: (
    state: State,
    event: Event,
  ) => TransitionResult<State, Command, Reason>;
}): TransitionResult<State, Command, Reason>[] {
  const results: TransitionResult<State, Command, Reason>[] = [];
  for (const state of options.states) {
    for (const event of options.events) {
      const result = options.transition(state, event);
      validateTransitionResult(state, event, result, []);
      results.push(result);
    }
  }
  return results;
}

export interface ReachableStateNode<State, Event> {
  readonly key: string;
  readonly state: State;
  readonly path: readonly Event[];
}

export interface ReachableStateEdge<State, Event, Command, Reason> {
  readonly source: ReachableStateNode<State, Event>;
  readonly target: ReachableStateNode<State, Event>;
  readonly event: Event;
  readonly result: TransitionResult<State, Command, Reason & IgnoreReason>;
}

export interface ReachableStateGraph<State, Event, Command, Reason> {
  readonly nodes: readonly ReachableStateNode<State, Event>[];
  readonly edges: readonly ReachableStateEdge<State, Event, Command, Reason>[];
  readonly predecessors: ReadonlyMap<
    string,
    ReachableStateEdge<State, Event, Command, Reason>
  >;
}

/**
 * Breadth-first exploration for machines whose reachable states can be
 * generated from a finite event set.
 */
export function exploreReachableStates<
  State,
  Event,
  Command,
  Reason extends IgnoreReason = IgnoreReason,
>(options: {
  initialState: State;
  events: readonly Event[] | ((state: State) => readonly Event[]);
  transition: (
    state: State,
    event: Event,
  ) => TransitionResult<State, Command, Reason>;
  stateKey: (state: State) => string;
  maxStates?: number;
}): ReachableStateGraph<State, Event, Command, Reason> {
  const maxStates = options.maxStates ?? 1_000;
  const initial: ReachableStateNode<State, Event> = {
    key: options.stateKey(options.initialState),
    state: options.initialState,
    path: [],
  };
  const nodes: ReachableStateNode<State, Event>[] = [initial];
  const byKey = new Map([[initial.key, initial]]);
  const edges: ReachableStateEdge<State, Event, Command, Reason>[] = [];
  const predecessors = new Map<
    string,
    ReachableStateEdge<State, Event, Command, Reason>
  >();

  for (let index = 0; index < nodes.length; index += 1) {
    const source = nodes[index];
    const events =
      typeof options.events === "function"
        ? options.events(source.state)
        : options.events;
    for (const event of events) {
      const result = options.transition(source.state, event);
      validateTransitionResult(source.state, event, result, source.path);
      const key = options.stateKey(result.state);
      let target = byKey.get(key);
      if (target === undefined) {
        if (nodes.length >= maxStates) {
          throw new Error(
            `Reachable-state exploration exceeded maxStates (${maxStates}); source state: ${describe(source.state)}; event: ${describe(event)}; result: ${describe(result)}; explored path: ${describe(source.path)}`,
          );
        }
        target = {
          key,
          state: result.state,
          path: [...source.path, event],
        };
        byKey.set(key, target);
        nodes.push(target);
      }
      const edge: ReachableStateEdge<State, Event, Command, Reason> = {
        source,
        target,
        event,
        result,
      };
      edges.push(edge);
      if (target !== initial && !predecessors.has(target.key)) {
        predecessors.set(target.key, edge);
      }
    }
  }

  return { nodes, edges, predecessors };
}

export interface InventoryExclusion<Kind extends string> {
  readonly kind: Kind;
  readonly reason: string;
}

function assertInventoryCovered<Kind extends string>(
  label: string,
  inventory: readonly Kind[],
  produced: ReadonlySet<Kind>,
  exclusions: readonly InventoryExclusion<Kind>[],
): void {
  const excluded = new Map(
    exclusions.map(({ kind, reason }) => [kind, reason]),
  );
  for (const kind of inventory) {
    if (produced.has(kind)) continue;
    const reason = excluded.get(kind);
    if (reason === undefined || reason.trim() === "") {
      throw new Error(`${label} "${kind}" was not reached or excluded`);
    }
  }
}

type ExplorationOptions<State, Event, Command, Reason extends IgnoreReason> = {
  initialState: State;
  events: readonly Event[] | ((state: State) => readonly Event[]);
  transition: (
    state: State,
    event: Event,
  ) => TransitionResult<State, Command, Reason>;
  stateKey: (state: State) => string;
  maxStates?: number;
};

export function assertAllStatesReachable<
  State,
  Event,
  Command,
  Reason extends IgnoreReason,
  Kind extends string,
>(
  options: ExplorationOptions<State, Event, Command, Reason> & {
    inventory: readonly Kind[];
    stateKind: (state: State) => Kind;
    exclusions?: readonly InventoryExclusion<Kind>[];
  },
): ReachableStateGraph<State, Event, Command, Reason> {
  const graph = exploreReachableStates(options);
  assertInventoryCovered(
    "State",
    options.inventory,
    new Set(graph.nodes.map(({ state }) => options.stateKind(state))),
    options.exclusions ?? [],
  );
  return graph;
}

export function assertAllCommandsProducible<
  State,
  Event,
  Command,
  Reason extends IgnoreReason,
  Kind extends string,
>(
  options: ExplorationOptions<State, Event, Command, Reason> & {
    inventory: readonly Kind[];
    commandKind: (command: Command) => Kind;
    exclusions?: readonly InventoryExclusion<Kind>[];
  },
): ReachableStateGraph<State, Event, Command, Reason> {
  const graph = exploreReachableStates(options);
  const produced = new Set<Kind>();
  for (const edge of graph.edges) {
    if (edge.result.kind !== "applied") continue;
    for (const command of edge.result.commands) {
      produced.add(options.commandKind(command));
    }
  }
  assertInventoryCovered(
    "Command",
    options.inventory,
    produced,
    options.exclusions ?? [],
  );
  return graph;
}

export function assertReferenceStability<
  State,
  Command,
  Reason extends IgnoreReason,
>(
  previous: State,
  result: TransitionResult<State, Command, Reason>,
  areEqual: (left: State, right: State) => boolean,
): void {
  if (result.kind === "ignored") {
    if (result.state !== previous) {
      throw new Error(
        "Ignored transitions must retain the state reference and emit no commands",
      );
    }
    return;
  }
  if (areEqual(previous, result.state) && previous !== result.state) {
    throw new Error(
      "A value-equal transition must not return a new state reference",
    );
  }
}

/** Test-only projection for assertions that apply to both result variants. */
export function commandsOf<State, Command, Reason extends IgnoreReason>(
  result: TransitionResult<State, Command, Reason>,
): readonly Command[] {
  return result.kind === "applied" ? result.commands : [];
}

/** Test-only projection for concise ignored-reason assertions. */
export function ignoreReasonOf<State, Command, Reason extends IgnoreReason>(
  result: TransitionResult<State, Command, Reason>,
): Reason | undefined {
  return result.kind === "ignored" ? result.reason : undefined;
}

export interface ConformanceController<State, Event> {
  getSnapshot(): State;
  subscribe(listener: () => void): () => void;
  send(event: Event): void;
  dispose(): void;
}

export interface ControllerConformanceAdapter<
  State,
  Event,
  Command,
  Reason extends IgnoreReason,
> {
  initialState: State;
  transition(
    state: State,
    event: Event,
  ): TransitionResult<State, Command, Reason>;
  create(options: {
    runCommand(
      command: Command,
      emit: (event: Event) => void,
    ): void | Promise<void>;
    observer?: import("./types").TransitionObserver<
      State,
      Event,
      Command,
      Reason
    >;
    beforeCommit?(previous: State, next: State): void;
    project?(state: State): void;
    reportError?(error: unknown): void;
    disposeCommands?(state: State): readonly Command[];
    cleanupProjection?(): void;
    releaseWriter?(): void;
    onDisposed?(): void;
  }): ConformanceController<State, Event>;
  events: {
    enterA: Event;
    enterB: Event;
    finish: Event;
    command(command: Command): Event;
  };
  errorStage(error: unknown): string | undefined;
  commands: {
    emit(event: Event): Command;
    syncThrow: Command;
    asyncReject: Command;
    awaitThen(event: Event): {
      command: Command;
      resolve(): void;
    };
    cleanup(state: State): readonly Command[];
  };
  /** One representative event for every reachable non-terminal state. */
  nonTerminalEvents: readonly { name: string; event: Event }[];
  stateKey(state: State): string;
}

function conformanceAssert(
  condition: unknown,
  scenario: string,
  detail: string,
): asserts condition {
  if (!condition) {
    throw new Error(`Controller conformance failed: ${scenario}: ${detail}`);
  }
}

async function flushConformancePromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createDeferredLifecycleDriver<
  Controller extends { dispose(): void },
>() {
  const generations = new Map<Controller, number>();
  return {
    mount(controller: Controller): () => void {
      const generation = (generations.get(controller) ?? 0) + 1;
      generations.set(controller, generation);
      return () => {
        queueMicrotask(() => {
          if (generations.get(controller) !== generation) return;
          generations.delete(controller);
          controller.dispose();
        });
      };
    },
  };
}

/**
 * Runs the shared adversarial controller contract.
 *
 * Domains provide representative states/events/commands, keeping concurrency,
 * cleanup, and staleness policy outside the harness. Failures name the exact
 * scenario so deliberately broken reference implementations fail usefully.
 */
export async function runControllerConformanceSuite<
  State,
  Event,
  Command,
  Reason extends IgnoreReason,
>(
  adapter: ControllerConformanceAdapter<State, Event, Command, Reason>,
): Promise<void> {
  {
    const order: string[] = [];
    let controller: ConformanceController<State, Event>;
    controller = adapter.create({
      runCommand: () => undefined,
      observer: {
        onTransitionApplied({ event }) {
          order.push(`observe:${describe(event)}`);
          if (order.length === 1) controller.send(adapter.events.enterB);
        },
      },
    });
    controller.send(adapter.events.enterA);
    conformanceAssert(
      adapter.stateKey(controller.getSnapshot()) ===
        adapter.stateKey(
          adapter.transition(
            adapter.transition(adapter.initialState, adapter.events.enterA)
              .state,
            adapter.events.enterB,
          ).state,
        ),
      "re-entrant observer dispatch",
      "the observer's event did not run after the committed outer event",
    );
  }

  {
    const seen: string[] = [];
    const controller = adapter.create({ runCommand: () => undefined });
    controller.subscribe(() => {
      seen.push(adapter.stateKey(controller.getSnapshot()));
      if (seen.length === 1) controller.send(adapter.events.enterB);
    });
    controller.send(adapter.events.enterA);
    conformanceAssert(
      seen.length >= 2,
      "re-entrant subscriber dispatch",
      "the subscriber's event was lost",
    );
  }

  {
    const command = adapter.commands.emit(adapter.events.enterB);
    const commandEvent = adapter.events.command(command);
    const controller = adapter.create({
      runCommand(current, emit) {
        if (Object.is(current, command)) emit(adapter.events.enterB);
      },
    });
    controller.send(commandEvent);
    const commandState = adapter.transition(
      adapter.initialState,
      commandEvent,
    ).state;
    conformanceAssert(
      adapter.stateKey(controller.getSnapshot()) ===
        adapter.stateKey(
          adapter.transition(commandState, adapter.events.enterB).state,
        ),
      "synchronous command emission",
      "the emitted event was not drained",
    );
  }

  {
    const errors: unknown[] = [];
    const command = adapter.commands.emit(adapter.events.enterB);
    const commandEvent = adapter.events.command(command);
    const controller = adapter.create({
      beforeCommit() {
        throw new Error("conformance before-commit throw");
      },
      runCommand: () => undefined,
      reportError: (error) => errors.push(error),
    });
    controller.send(commandEvent);
    const commandState = adapter.transition(
      adapter.initialState,
      commandEvent,
    ).state;
    conformanceAssert(
      errors.length === 2 &&
        errors.every(
          (error) => adapter.errorStage(error) === "before-commit",
        ) &&
        adapter.stateKey(controller.getSnapshot()) ===
          adapter.stateKey(
            adapter.transition(commandState, adapter.events.enterB).state,
          ),
      "before-commit failure preserves progress",
      "the failure was not reported, commit was vetoed, or synchronous follow-up work stopped",
    );
  }

  {
    const errors: unknown[] = [];
    const controller = adapter.create({
      runCommand(command) {
        if (Object.is(command, adapter.commands.syncThrow)) {
          throw new Error("conformance sync throw");
        }
      },
      reportError: (error) => errors.push(error),
    });
    controller.send(adapter.events.command(adapter.commands.syncThrow));
    controller.send(adapter.events.enterA);
    conformanceAssert(
      errors.length === 1 &&
        adapter.stateKey(controller.getSnapshot()) !==
          adapter.stateKey(adapter.initialState),
      "synchronous runner throw",
      "the error was not reported or the queue wedged",
    );
  }

  {
    const errors: unknown[] = [];
    const controller = adapter.create({
      runCommand(command) {
        if (Object.is(command, adapter.commands.asyncReject)) {
          return Promise.reject(new Error("conformance async rejection"));
        }
      },
      reportError: (error) => errors.push(error),
    });
    controller.send(adapter.events.command(adapter.commands.asyncReject));
    controller.send(adapter.events.enterA);
    await flushConformancePromises();
    conformanceAssert(
      errors.length === 1 &&
        adapter.stateKey(controller.getSnapshot()) !==
          adapter.stateKey(adapter.initialState),
      "asynchronous runner rejection",
      "the rejection was not reported or later events stopped",
    );
  }

  {
    const deferred = adapter.commands.awaitThen(adapter.events.enterB);
    const commandEvent = adapter.events.command(deferred.command);
    const controller = adapter.create({
      runCommand(command, emit) {
        if (!Object.is(command, deferred.command)) return;
        return new Promise<void>((resolve) => {
          const originalResolve = deferred.resolve;
          deferred.resolve = () => {
            originalResolve();
            emit(adapter.events.enterB);
            resolve();
          };
        });
      },
    });
    controller.send(commandEvent);
    const snapshotAtDispose = controller.getSnapshot();
    controller.dispose();
    deferred.resolve();
    await flushConformancePromises();
    conformanceAssert(
      adapter.stateKey(controller.getSnapshot()) ===
        adapter.stateKey(snapshotAtDispose),
      "dispose during await",
      "a completion changed state after disposal",
    );
  }

  {
    const controller = adapter.create({ runCommand: () => undefined });
    controller.dispose();
    controller.send(adapter.events.enterA);
    conformanceAssert(
      adapter.stateKey(controller.getSnapshot()) ===
        adapter.stateKey(adapter.initialState),
      "post-dispose emit",
      "an event was admitted after disposal",
    );
  }

  {
    const stale = adapter.commands.awaitThen(adapter.events.enterB);
    let generation = 0;
    const host = new KeyedControllerHost<
      string,
      ConformanceController<State, Event>
    >(() => {
      generation += 1;
      return adapter.create({
        runCommand(command, emit) {
          if (generation !== 1 || !Object.is(command, stale.command)) return;
          const originalResolve = stale.resolve;
          stale.resolve = () => {
            originalResolve();
            emit(adapter.events.enterB);
          };
        },
      });
    });
    const old = host.ensure("entity");
    old.send(adapter.events.command(stale.command));
    host.disposeKey("entity");
    const replacement = host.ensure("entity");
    replacement.send(adapter.events.enterA);
    stale.resolve();
    conformanceAssert(
      adapter.stateKey(replacement.getSnapshot()) ===
        adapter.stateKey(
          adapter.transition(adapter.initialState, adapter.events.enterA).state,
        ),
      "key dispose/recreate with stale events",
      "an old controller affected its replacement",
    );
    host.dispose();
  }

  {
    const disposal = { count: 0 };
    const disposalCount = () => disposal.count;
    const replayed = adapter.create({
      runCommand: () => undefined,
      onDisposed: () => {
        disposal.count += 1;
      },
    });
    const lifecycle = createDeferredLifecycleDriver();
    const cleanupFirstMount = lifecycle.mount(replayed);
    cleanupFirstMount();
    const cleanupReplay = lifecycle.mount(replayed);
    await flushConformancePromises();
    replayed.send(adapter.events.enterA);
    conformanceAssert(
      disposalCount() === 0 &&
        adapter.stateKey(replayed.getSnapshot()) !==
          adapter.stateKey(adapter.initialState),
      "StrictMode replay",
      "the replayed setup did not cancel deferred disposal",
    );
    cleanupReplay();
    await flushConformancePromises();
    conformanceAssert(
      disposalCount() === 1,
      "StrictMode replay",
      "final cleanup did not dispose exactly once",
    );
  }

  {
    const disposals = { a: 0, b: 0 };
    const aDisposeCount = () => disposals.a;
    const bDisposeCount = () => disposals.b;
    const a = adapter.create({
      runCommand: () => undefined,
      onDisposed: () => {
        disposals.a += 1;
      },
    });
    const b = adapter.create({
      runCommand: () => undefined,
      onDisposed: () => {
        disposals.b += 1;
      },
    });
    const lifecycle = createDeferredLifecycleDriver();
    lifecycle.mount(a)();
    lifecycle.mount(b)();
    lifecycle.mount(a)();
    const cleanupFinalB = lifecycle.mount(b);
    await flushConformancePromises();
    b.send(adapter.events.enterB);
    conformanceAssert(
      aDisposeCount() === 1 &&
        bDisposeCount() === 0 &&
        adapter.stateKey(b.getSnapshot()) !==
          adapter.stateKey(adapter.initialState),
      "A to B to A to B replacement",
      "a prior generation disposed the final replacement",
    );
    cleanupFinalB();
    await flushConformancePromises();
    conformanceAssert(
      bDisposeCount() === 1,
      "A to B to A to B replacement",
      "the final replacement did not dispose exactly once",
    );
  }

  {
    const order: string[] = [];
    const controller = adapter.create({
      runCommand: () => undefined,
      cleanupProjection: () => order.push("projection-cleanup"),
      releaseWriter: () => order.push("writer-release"),
    });
    controller.dispose();
    conformanceAssert(
      order.join(",") === "projection-cleanup,writer-release",
      "projection cleanup before writer release",
      `observed ${order.join(",")}`,
    );
  }

  for (const { name, event } of adapter.nonTerminalEvents) {
    const finalizers: Command[] = [];
    let disposeCount = 0;
    let projectionCleanupCount = 0;
    let writerReleaseCount = 0;
    const controller = adapter.create({
      runCommand(command) {
        finalizers.push(command);
      },
      disposeCommands: (state) => adapter.commands.cleanup(state),
      cleanupProjection() {
        projectionCleanupCount += 1;
      },
      releaseWriter() {
        writerReleaseCount += 1;
      },
      onDisposed() {
        disposeCount += 1;
      },
    });
    controller.send(event);
    controller.dispose();
    controller.dispose();
    await flushConformancePromises();
    conformanceAssert(
      disposeCount === 1 &&
        projectionCleanupCount === 1 &&
        writerReleaseCount === 1 &&
        finalizers.length > 0,
      "dispose from every reachable non-terminal state",
      `${name} (${adapter.stateKey(controller.getSnapshot())}) did not clean projection/resources exactly once`,
    );
  }
}

export function replayTrace<State, Event, Command, SerializedEvent>(options: {
  initialState: State;
  trace: ReplayTrace<SerializedEvent>;
  serialization: ReplaySerialization<State, Event, Command, SerializedEvent>;
  transition: (state: State, event: Event) => TransitionResult<State, Command>;
}): State {
  if (options.trace.schemaVersion !== options.serialization.schemaVersion) {
    throw new Error(
      `Unsupported replay trace schema version ${options.trace.schemaVersion}; expected ${options.serialization.schemaVersion}`,
    );
  }
  let state = options.initialState;
  const replayedEvents: Event[] = [];
  for (let index = 0; index < options.trace.entries.length; index += 1) {
    const entry = options.trace.entries[index];
    try {
      const event = options.serialization.deserializeEvent(entry.event);
      const result = options.transition(state, event);
      validateTransitionResult(state, event, result, replayedEvents);
      const actual =
        result.kind === "ignored"
          ? {
              kind: result.kind,
              reason: result.reason,
              stateKey: options.serialization.stateKey(result.state),
            }
          : {
              kind: result.kind,
              stateKey: options.serialization.stateKey(result.state),
              commands: result.commands.map((command) =>
                options.serialization.describeCommand(command),
              ),
            };
      if (!valuesAreEqual(actual, entry.outcome)) {
        throw new Error(
          `expected ${describe(entry.outcome)}, received ${describe(actual)}`,
        );
      }
      state = result.state;
      replayedEvents.push(event);
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : `threw ${describe(error)}`;
      throw new Error(`Replay diverged at prefix ${index + 1}: ${detail}`);
    }
  }
  return state;
}

export function createRecordingCommandRunner<Command, Event>(
  implementation?: (
    command: Command,
    emit: (event: Event) => void,
  ) => void | Promise<void>,
) {
  const commands: Command[] = [];
  const events: Event[] = [];
  const run = async (
    command: Command,
    emit: (event: Event) => void,
  ): Promise<void> => {
    commands.push(command);
    await implementation?.(command, (event) => {
      events.push(event);
      emit(event);
    });
  };
  return { commands, events, run };
}
