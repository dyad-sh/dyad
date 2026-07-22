import { describe, expect, it } from "vitest";
import {
  assertReferenceStability,
  createRecordingCommandRunner,
  driveTransitionMatrix,
  exploreReachableStates,
} from "./testing";
import { ignore, type TransitionResult } from "./types";

describe("state-machine test kit", () => {
  it("drives every state and event pair", () => {
    const results = driveTransitionMatrix<number, string, never>({
      states: [0, 1],
      events: ["a", "b"],
      transition: (state) => ignore(state, "test-ignore"),
    });
    expect(results).toHaveLength(4);
  });

  it("rejects value-equal snapshots with new references", () => {
    const previous = { value: 1 };
    const result: TransitionResult<typeof previous, never> = {
      state: { value: 1 },
      commands: [],
    };
    expect(() =>
      assertReferenceStability(
        previous,
        result,
        (left, right) => left.value === right.value,
      ),
    ).toThrow(/value-equal/);
  });

  it("records commands and emitted events", async () => {
    const runner = createRecordingCommandRunner<string, number>(
      (_command, emit) => emit(3),
    );
    const emitted: number[] = [];
    await runner.run("run", (event) => emitted.push(event));
    expect(runner.commands).toEqual(["run"]);
    expect(runner.events).toEqual([3]);
    expect(emitted).toEqual([3]);
  });

  it("explores reachable states without revisiting equivalent snapshots", () => {
    const states = exploreReachableStates<number, "increment" | "reset", never>(
      {
        initialState: 0,
        events: ["increment", "reset"],
        transition: (state, event) => ({
          state: event === "reset" ? 0 : Math.min(state + 1, 2),
          commands: [],
        }),
        stateKey: String,
      },
    );

    expect(states).toEqual([0, 1, 2]);
  });

  it("bounds accidental infinite state spaces", () => {
    expect(() =>
      exploreReachableStates<number, "increment", never>({
        initialState: 0,
        events: ["increment"],
        transition: (state) => ({ state: state + 1, commands: [] }),
        stateKey: String,
        maxStates: 3,
      }),
    ).toThrow(/maxStates/);
  });
});
