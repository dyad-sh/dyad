/** A machine-specific, stable tag explaining why an event was ignored. */
export type IgnoreReason<Tag extends string = string> = Tag;

/** Canonical trace reason for a completion belonging to another operation. */
export const STALE_OPERATION_IGNORE_REASON = "stale-operation" as const;
export type StaleOperationIgnoreReason = typeof STALE_OPERATION_IGNORE_REASON;

/** Transport-neutral metadata that links one dispatch to its causal chain. */
export interface DispatchContext {
  readonly messageId: string;
  readonly correlationId?: string;
  readonly causationId?: string;
}

/**
 * The common result shape for pure state-machine transitions.
 *
 * Applied transitions may keep the same state reference when they only emit
 * commands. Ignored transitions always keep the state reference and emit no
 * commands.
 */
export type TransitionResult<
  State,
  Command,
  Reason extends IgnoreReason = IgnoreReason,
  Outcome = never,
> =
  | { kind: "ignored"; state: State; reason: Reason }
  | {
      kind: "applied";
      state: State;
      commands: readonly Command[];
      outcomes?: readonly Outcome[];
    };

/** Explicitly marks a deliberate no-op in a total transition matrix. */
export function ignore<
  State,
  Command = never,
  Reason extends IgnoreReason = IgnoreReason,
>(state: State, reason: Reason): TransitionResult<State, Command, Reason> {
  return { kind: "ignored", state, reason };
}

/** Apply a transition to a next state, optionally emitting commands. */
export function change<State, Command = never>(
  nextState: State,
  commands?: readonly Command[],
): TransitionResult<State, Command, never, never>;
export function change<State, Command, Outcome>(
  nextState: State,
  commands: readonly Command[],
  outcomes: readonly Outcome[],
): TransitionResult<State, Command, never, Outcome>;
export function change<State, Command = never, Outcome = never>(
  nextState: State,
  commands: readonly Command[] = [],
  outcomes: readonly Outcome[] = [],
): TransitionResult<State, Command, never, Outcome> {
  return outcomes.length === 0
    ? { kind: "applied", state: nextState, commands }
    : { kind: "applied", state: nextState, commands, outcomes };
}

/** Apply commands while deliberately retaining the current state reference. */
export function stay<State, Command>(
  state: State,
  commands: readonly Command[],
): TransitionResult<State, Command, never, never>;
export function stay<State, Command, Outcome>(
  state: State,
  commands: readonly Command[],
  outcomes: readonly Outcome[],
): TransitionResult<State, Command, never, Outcome>;
export function stay<State, Command, Outcome = never>(
  state: State,
  commands: readonly Command[],
  outcomes: readonly Outcome[] = [],
): TransitionResult<State, Command, never, Outcome> {
  return outcomes.length === 0
    ? { kind: "applied", state, commands }
    : { kind: "applied", state, commands, outcomes };
}

export interface AppliedTransition<State, Event, Command> {
  previous: State;
  event: Event;
  state: State;
  commands: readonly Command[];
  dispatchContext?: DispatchContext;
}

export interface IgnoredEvent<State, Event, Reason extends IgnoreReason> {
  state: State;
  event: Event;
  reason: Reason;
  dispatchContext?: DispatchContext;
}

/** Optional telemetry hooks shared by controllers and registries. */
export interface TransitionObserver<
  State,
  Event,
  Command,
  Reason extends IgnoreReason = IgnoreReason,
> {
  onTransitionApplied?(
    transition: AppliedTransition<State, Event, Command>,
  ): void;
  onEventIgnored?(event: IgnoredEvent<State, Event, Reason>): void;
}

/** Notify an observer without making controllers duplicate result plumbing. */
export function observeTransition<
  State,
  Event,
  Command,
  Reason extends IgnoreReason,
>(
  observer: TransitionObserver<State, Event, Command, Reason> | undefined,
  previous: State,
  event: Event,
  result: TransitionResult<State, Command, Reason>,
  dispatchContext?: DispatchContext,
): void {
  if (result.kind === "ignored") {
    observer?.onEventIgnored?.({
      state: previous,
      event,
      reason: result.reason,
      ...(dispatchContext ? { dispatchContext } : {}),
    });
    return;
  }
  observer?.onTransitionApplied?.({
    previous,
    event,
    state: result.state,
    commands: result.commands,
    ...(dispatchContext ? { dispatchContext } : {}),
  });
}
