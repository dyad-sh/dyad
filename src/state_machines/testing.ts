import type { IgnoreReason, TransitionResult } from "./types";

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
