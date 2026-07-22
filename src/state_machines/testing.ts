import type { IgnoreReason, TransitionResult } from "./types";
import type { Clock, ClockHandle, IdSource } from "./clock";

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

export function driveTransitionMatrix<State, Event, Command>(options: {
  states: readonly State[];
  events: readonly Event[];
  transition: (state: State, event: Event) => TransitionResult<State, Command>;
}): TransitionResult<State, Command>[] {
  const results: TransitionResult<State, Command>[] = [];
  for (const state of options.states) {
    for (const event of options.events) {
      const result = options.transition(state, event);
      if (result === undefined || result === null) {
        throw new Error("Transition did not return a result");
      }
      results.push(result);
    }
  }
  return results;
}

/** Replays captured trace events through a pure transition function. */
export function replayTrace<State, Event, Command>(options: {
  initialState: State;
  entries: readonly { event: Event }[];
  transition: (state: State, event: Event) => TransitionResult<State, Command>;
}): State {
  return options.entries.reduce(
    (state, entry) => options.transition(state, entry.event).state,
    options.initialState,
  );
}

/**
 * Breadth-first exploration for machines whose reachable states can be
 * generated from a finite event set. State keys deliberately come from the
 * domain so the shared kit does not prescribe serialization or equality.
 */
export function exploreReachableStates<State, Event, Command>(options: {
  initialState: State;
  events: readonly Event[] | ((state: State) => readonly Event[]);
  transition: (state: State, event: Event) => TransitionResult<State, Command>;
  stateKey: (state: State) => string;
  maxStates?: number;
}): State[] {
  const maxStates = options.maxStates ?? 1_000;
  const states: State[] = [options.initialState];
  const seen = new Set([options.stateKey(options.initialState)]);

  for (let index = 0; index < states.length; index += 1) {
    const state = states[index];
    const events =
      typeof options.events === "function"
        ? options.events(state)
        : options.events;
    for (const event of events) {
      const result = options.transition(state, event);
      const key = options.stateKey(result.state);
      if (seen.has(key)) continue;
      if (states.length >= maxStates) {
        throw new Error(
          `Reachable-state exploration exceeded maxStates (${maxStates})`,
        );
      }
      seen.add(key);
      states.push(result.state);
    }
  }

  return states;
}

export function assertReferenceStability<
  State,
  Command,
  Reason extends IgnoreReason,
>(
  previous: State,
  result: TransitionResult<State, Command, Reason>,
  valuesAreEqual: (left: State, right: State) => boolean,
): void {
  if (result.ignoredReason !== undefined) {
    if (result.state !== previous || result.commands.length !== 0) {
      throw new Error(
        "Ignored transitions must retain the state reference and emit no commands",
      );
    }
    return;
  }
  if (valuesAreEqual(previous, result.state) && previous !== result.state) {
    throw new Error(
      "A value-equal transition must not return a new state reference",
    );
  }
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
