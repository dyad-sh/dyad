import { describe, expect, it } from "vitest";
import {
  assertAllCommandsProducible,
  assertAllStatesReachable,
  assertReferenceStability,
  commandsOf,
  createRecordingCommandRunner,
  driveTransitionMatrix,
  exploreReachableStates,
  ignoreReasonOf,
} from "./testing";
import { change, ignore, stay, type TransitionResult } from "./types";

describe("state-machine test kit", () => {
  it("constructs ignored, changed, and command-only applied results", () => {
    const state = { value: 1 };
    expect(ignore(state, "no-change")).toEqual({
      kind: "ignored",
      state,
      reason: "no-change",
    });
    expect(change({ value: 2 })).toEqual({
      kind: "applied",
      state: { value: 2 },
      commands: [],
    });
    expect(stay(state, ["refresh"])).toEqual({
      kind: "applied",
      state,
      commands: ["refresh"],
    });
  });

  it("makes commands on ignored results a compile error", () => {
    const invalid: TransitionResult<number, string> = {
      kind: "ignored",
      state: 0,
      reason: "no-change",
      // @ts-expect-error ignored results cannot carry commands
      commands: ["invalid"],
    };
    expect(invalid).toBeDefined();
  });

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
      kind: "applied",
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

  it("validates every matrix result with useful transition context", () => {
    expect(() =>
      driveTransitionMatrix({
        states: [{ value: 1 }],
        events: ["repeat"],
        transition: (state) =>
          ({
            kind: "ignored",
            state,
            reason: "no-change",
            commands: ["invalid"],
          }) as unknown as TransitionResult<typeof state, string, "no-change">,
      }),
    ).toThrow(
      /Ignored transitions must not emit commands[\s\S]*Source state[\s\S]*repeat[\s\S]*Explored path/,
    );
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

  it("returns reachable nodes, edges, paths, and predecessors", () => {
    const graph = exploreReachableStates<number, "increment" | "reset", never>({
      initialState: 0,
      events: ["increment", "reset"],
      transition: (state, event) => ({
        kind: "applied",
        state: event === "reset" ? 0 : Math.min(state + 1, 2),
        commands: [],
      }),
      stateKey: String,
    });

    expect(graph.nodes.map(({ state }) => state)).toEqual([0, 1, 2]);
    expect(graph.edges).toHaveLength(6);
    expect(graph.nodes[2].path).toEqual(["increment", "increment"]);
    expect(graph.predecessors.get("2")?.source.state).toBe(1);
  });

  it("reports exploration validation failures with the explored path", () => {
    expect(() =>
      exploreReachableStates({
        initialState: 0,
        events: ["advance"],
        transition: (state) =>
          state === 0
            ? change(1)
            : ({
                kind: "ignored",
                state: 0,
                reason: "bad-reference",
              } as TransitionResult<number, never, "bad-reference">),
        stateKey: String,
      }),
    ).toThrow(/exact state reference[\s\S]*advance[\s\S]*Explored path/);
  });

  it("asserts all inventoried state kinds are reachable", () => {
    const options = {
      initialState: "idle" as "idle" | "running",
      events: ["start"] as const,
      transition: (state: "idle" | "running") =>
        state === "idle" ? change("running" as const) : ignore(state, "busy"),
      stateKey: String,
      stateKind: (state: "idle" | "running") => state,
      inventory: ["idle", "running"] as const,
    };
    expect(assertAllStatesReachable(options).nodes).toHaveLength(2);
    expect(() =>
      assertAllStatesReachable({
        ...options,
        inventory: ["idle", "running", "dead"] as const,
      }),
    ).toThrow(/State "dead"/);
    expect(() =>
      assertAllStatesReachable({
        ...options,
        inventory: ["idle", "running", "dead"] as const,
        exclusions: [{ kind: "dead" as const, reason: "reserved protocol" }],
      }),
    ).not.toThrow();
  });

  it("asserts all inventoried command kinds are producible", () => {
    const options = {
      initialState: "idle",
      events: ["start"] as const,
      transition: () => stay("idle", ["launch"] as const),
      stateKey: String,
      commandKind: (command: "launch") => command,
      inventory: ["launch"] as const,
    };
    expect(assertAllCommandsProducible(options).edges).toHaveLength(1);
    expect(() =>
      assertAllCommandsProducible({
        ...options,
        inventory: ["launch", "dead"] as const,
      }),
    ).toThrow(/Command "dead"/);
    expect(() =>
      assertAllCommandsProducible({
        ...options,
        inventory: ["launch", "dead"] as const,
        exclusions: [{ kind: "dead" as const, reason: "reserved protocol" }],
      }),
    ).not.toThrow();
  });

  it("projects commands and reasons from discriminated results", () => {
    expect(commandsOf(stay(0, ["refresh"]))).toEqual(["refresh"]);
    expect(commandsOf(ignore(0, "idle"))).toEqual([]);
    expect(ignoreReasonOf(ignore(0, "idle"))).toBe("idle");
    expect(ignoreReasonOf(change(1))).toBeUndefined();
  });

  it("bounds accidental infinite state spaces", () => {
    expect(() =>
      exploreReachableStates<number, "increment", never>({
        initialState: 0,
        events: ["increment"],
        transition: (state) => ({
          kind: "applied",
          state: state + 1,
          commands: [],
        }),
        stateKey: String,
        maxStates: 3,
      }),
    ).toThrow(/maxStates/);
  });
});
