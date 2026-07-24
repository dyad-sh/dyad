import type { IgnoreReason, TransitionResult } from "./types";
import type { Clock, ClockHandle, IdSource } from "./clock";
import type { ReplaySerialization, ReplayTrace } from "./trace";

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

function describe(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function valuesAreEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null
  ) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => valuesAreEqual(value, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        valuesAreEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function validationFailure(
  message: string,
  context: {
    state: unknown;
    event: unknown;
    result: unknown;
    path: readonly unknown[];
  },
): never {
  throw new Error(
    `${message}\nSource state: ${describe(context.state)}\nEvent: ${describe(context.event)}\nResult: ${describe(context.result)}\nExplored path: ${describe(context.path)}`,
  );
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

export function validateTransitionResult<
  State,
  Event,
  Command,
  Reason extends IgnoreReason,
>(
  previous: State,
  event: Event,
  result: TransitionResult<State, Command, Reason>,
  path: readonly Event[] = [],
): void {
  const context = { state: previous, event, result, path };
  if (typeof result !== "object" || result === null) {
    validationFailure("Transition did not return a valid result", context);
  }
  if (!("state" in result)) {
    validationFailure("Transition result must include a state", context);
  }
  if (result.kind === "ignored") {
    if (result.state !== previous) {
      validationFailure(
        "Ignored transitions must retain the exact state reference",
        context,
      );
    }
    if (!("reason" in result) || typeof result.reason !== "string") {
      validationFailure("Ignored transitions must include a reason", context);
    }
    if ("commands" in result) {
      validationFailure("Ignored transitions must not emit commands", context);
    }
    return;
  }
  if (result.kind !== "applied" || !Array.isArray(result.commands)) {
    validationFailure("Transition did not return a valid result", context);
  }
  if (valuesAreEqual(previous, result.state) && previous !== result.state) {
    validationFailure(
      "Applied value-equal states must reuse the previous reference",
      context,
    );
  }
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
