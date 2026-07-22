/** A machine-specific, stable tag explaining why an event was ignored. */
export type IgnoreReason<Tag extends string = string> = Tag;

/**
 * The common result shape for pure state-machine transitions.
 *
 * Applied transitions may keep the same state reference when they only emit
 * commands. Ignored transitions always keep the state reference and emit no
 * commands.
 */
export interface TransitionResult<
  State,
  Command,
  Reason extends IgnoreReason = IgnoreReason,
> {
  state: State;
  commands: readonly Command[];
  ignoredReason?: Reason;
}

/** Result shape for commandless registries that expose an explicit flag. */
export type StateTransitionResult<
  State,
  Reason extends IgnoreReason = IgnoreReason,
> =
  | { changed: true; state: State }
  | { changed: false; state: State; reason: Reason };

export function advanceState<State>(
  state: State,
): StateTransitionResult<State, never> {
  return { changed: true, state };
}

export function ignoreState<State, Reason extends IgnoreReason = IgnoreReason>(
  state: State,
  reason: Reason,
): StateTransitionResult<State, Reason> {
  return { changed: false, state, reason };
}

/** Explicitly marks a deliberate no-op in a total transition matrix. */
export function ignore<
  State,
  Command = never,
  Reason extends IgnoreReason = IgnoreReason,
>(state: State, reason: Reason): TransitionResult<State, Command, Reason> {
  return { state, commands: [], ignoredReason: reason };
}

export interface AppliedTransition<State, Event, Command> {
  previous: State;
  event: Event;
  state: State;
  commands: readonly Command[];
}

export interface IgnoredEvent<State, Event, Reason extends IgnoreReason> {
  state: State;
  event: Event;
  reason: Reason;
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
): void {
  if (result.ignoredReason !== undefined) {
    observer?.onEventIgnored?.({
      state: previous,
      event,
      reason: result.ignoredReason,
    });
    return;
  }
  observer?.onTransitionApplied?.({
    previous,
    event,
    state: result.state,
    commands: result.commands,
  });
}
