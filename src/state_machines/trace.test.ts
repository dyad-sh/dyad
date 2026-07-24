import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PreviewCommand,
  PreviewEvent,
  PreviewState,
} from "@/version_preview/state";
import { CLOSED_STATE } from "@/version_preview/state";
import { transition } from "@/version_preview/transition";
import {
  createReplayTraceObserver,
  createTraceObserver,
  getTraceLog,
} from "./trace";
import {
  change,
  observeTransition,
  stay,
  type TransitionResult,
} from "./types";
import { replayTrace } from "./testing";

let sequence = 0;

function machineName(label: string): string {
  sequence += 1;
  return `trace-test-${label}-${sequence}`;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("machine trace observer", () => {
  it("caps each entity-key ring independently", () => {
    const machine = machineName("cap");
    const first = createTraceObserver<number, string, string>(machine, 7, {
      maxEntries: 2,
    });
    const second = createTraceObserver<number, string, string>(machine, 8, {
      maxEntries: 2,
    });

    for (let value = 0; value < 3; value += 1) {
      first.onTransitionApplied?.({
        previous: value,
        event: `first-${value}`,
        state: value + 1,
        commands: [],
      });
      second.onTransitionApplied?.({
        previous: value,
        event: `second-${value}`,
        state: value + 1,
        commands: [],
      });
    }

    expect(getTraceLog(machine)).toMatchObject([
      { machine, key: 7, from: 1, event: "first-1", to: 2 },
      { machine, key: 8, from: 1, event: "second-1", to: 2 },
      { machine, key: 7, from: 2, event: "first-2", to: 3 },
      { machine, key: 8, from: 2, event: "second-2", to: 3 },
    ]);
  });

  it("uses sequence numbers to preserve same-millisecond causal order", () => {
    vi.spyOn(Date, "now").mockReturnValue(42);
    const firstMachine = machineName("ordered-first");
    const secondMachine = machineName("ordered-second");
    const first = createTraceObserver<number, string, never>(firstMachine);
    const second = createTraceObserver<number, string, never>(secondMachine);

    second.onTransitionApplied?.({
      previous: 0,
      event: "second",
      state: 1,
      commands: [],
    });
    first.onTransitionApplied?.({
      previous: 0,
      event: "first",
      state: 1,
      commands: [],
    });

    const entries = getTraceLog().filter(
      (entry) =>
        entry.machine === firstMachine || entry.machine === secondMachine,
    );
    expect(
      entries.map(({ machine, sequence }) => ({ machine, sequence })),
    ).toEqual([
      { machine: secondMachine, sequence: entries[0].sequence },
      { machine: firstMachine, sequence: entries[1].sequence },
    ]);
    expect(entries[1].sequence).toBeGreaterThan(entries[0].sequence);
  });

  it("captures ignored reasons and supports compact descriptions and muting", () => {
    const machine = machineName("ignored");
    const observer = createTraceObserver<
      { type: string },
      { type: string },
      { type: string }
    >(machine, undefined, {
      describeState: (state) => state.type,
      describeEvent: (event) => event.type,
      describeCommand: (command) => command.type,
      mute: (event) => event.type === "chunk",
    });

    observer.onEventIgnored?.({
      state: { type: "idle" },
      event: { type: "stale" },
      reason: "already-idle",
    });
    observer.onEventIgnored?.({
      state: { type: "idle" },
      event: { type: "chunk" },
      reason: "stale-stream-id",
    });

    expect(getTraceLog(machine)).toMatchObject([
      {
        from: "idle",
        event: "stale",
        to: "idle",
        commands: [],
        ignoredReason: "already-idle",
      },
    ]);
  });

  it("redacts untagged objects instead of retaining them", () => {
    const machine = machineName("untagged");
    const observer = createTraceObserver<object, object, object>(machine);
    const previous = { secret: "before" };
    const event = { secret: "event" };
    const state = { secret: "after" };
    const command = { secret: "command" };
    observer.onTransitionApplied?.({
      previous,
      event,
      state,
      commands: [command],
    });
    expect(getTraceLog(machine)[0]).toMatchObject({
      from: "[redacted untagged object]",
      event: "[redacted untagged object]",
      to: "[redacted untagged object]",
      commands: ["[redacted untagged object]"],
    });
  });

  it("keeps aggregate trace retention bounded across entity keys", () => {
    const machine = machineName("total-cap");
    for (let key = 0; key < 101; key += 1) {
      const observer = createTraceObserver<number, number, never>(machine, key);
      for (let event = 0; event < 100; event += 1) {
        observer.onTransitionApplied?.({
          previous: event,
          event,
          state: event + 1,
          commands: [],
        });
      }
    }

    expect(getTraceLog(machine)).toHaveLength(10_000);
  });

  it("is safe to import in a main-process environment without window", async () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "window",
    );
    Reflect.deleteProperty(globalThis, "window");
    try {
      vi.resetModules();
      const mainTrace = await import("./trace");
      const machine = machineName("main-import");
      const observer = mainTrace.createTraceObserver<number, string, never>(
        machine,
      );
      observer.onTransitionApplied?.({
        previous: 0,
        event: "advance",
        state: 1,
        commands: [],
      });
      expect(mainTrace.getTraceLog(machine)).toHaveLength(1);
    } finally {
      if (windowDescriptor) {
        Object.defineProperty(globalThis, "window", windowDescriptor);
      }
    }
  });

  it("exposes the machine index and dump helper in renderer environments", () => {
    const machine = machineName("devtools");
    createTraceObserver<number, string, never>(machine);

    expect(window.__dyadMachines?.index).toContain(machine);
    expect(window.__dyadMachines?.dump(machine)).toEqual([]);
  });

  it("does not expose machine devtools in production builds", async () => {
    Reflect.deleteProperty(window, "__dyadMachines");
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    await import("./trace");

    expect(window.__dyadMachines).toBeUndefined();

    vi.unstubAllEnvs();
    vi.resetModules();
    await import("./trace");
  });

  it("records and replays full serialized events through every transition", () => {
    const serialization = {
      schemaVersion: 1,
      serializeEvent: (event: PreviewEvent) => event,
      deserializeEvent: (event: PreviewEvent) => event,
      stateKey: (state: PreviewState) => JSON.stringify(state),
      describeCommand: (command: PreviewCommand) => command,
    };
    const replay = createReplayTraceObserver<
      PreviewState,
      PreviewEvent,
      PreviewCommand,
      PreviewEvent
    >(serialization);
    const events: PreviewEvent[] = [
      { type: "OPEN", appId: 7 },
      { type: "SELECT_VERSION", versionId: "version-1" },
      { type: "ORIGIN_RESOLVED", branch: "main" },
    ];

    let state = CLOSED_STATE;
    for (const event of events) {
      const previous = state;
      const result = transition(state, event);
      observeTransition(replay.observer, previous, event, result);
      state = result.state;
    }

    const replayed = replayTrace({
      initialState: CLOSED_STATE,
      trace: replay.getTrace(),
      serialization,
      transition,
    });
    expect(replayed).toEqual(state);
  });

  it("preserves a method-based command serializer receiver", () => {
    const serialization = {
      schemaVersion: 3,
      serializeEvent(event: string) {
        return event;
      },
      deserializeEvent(event: string) {
        return event;
      },
      stateKey: String,
      describeCommand(command: string) {
        return `${this.schemaVersion}:${command}`;
      },
    };
    const replay = createReplayTraceObserver(serialization);
    replay.observer.onTransitionApplied?.({
      previous: 0,
      event: "run",
      state: 0,
      commands: ["launch"],
    });

    expect(replay.getTrace().entries[0].outcome).toEqual({
      kind: "applied",
      stateKey: "0",
      commands: ["3:launch"],
    });
    expect(
      replayTrace({
        initialState: 0,
        trace: replay.getTrace(),
        serialization,
        transition: (state) => stay(state, ["launch"]),
      }),
    ).toBe(0);
  });

  it("reports the shortest divergent replay prefix", () => {
    expect(() =>
      replayTrace({
        initialState: 0,
        trace: {
          schemaVersion: 1,
          entries: [
            {
              event: "advance",
              outcome: {
                kind: "ignored",
                reason: "disposed",
                stateKey: "0",
              },
            },
          ],
        },
        serialization: {
          schemaVersion: 1,
          serializeEvent: (event: string) => event,
          deserializeEvent: (event: string) => event,
          stateKey: String,
          describeCommand: (command: never) => command,
        },
        transition: (state: number) => ({
          kind: "applied" as const,
          state: state + 1,
          commands: [],
        }),
      }),
    ).toThrow(/prefix 1/);
  });

  it("rejects unsupported replay schema versions before replay", () => {
    const transitionSpy = vi.fn(() => ({
      kind: "applied" as const,
      state: 1,
      commands: [],
    }));
    expect(() =>
      replayTrace({
        initialState: 0,
        trace: { schemaVersion: 2, entries: [] },
        serialization: {
          schemaVersion: 1,
          serializeEvent: (event: never) => event,
          deserializeEvent: (event: never) => event,
          stateKey: String,
          describeCommand: (command: never) => command,
        },
        transition: transitionSpy,
      }),
    ).toThrow(/schema version 2/);
    expect(transitionSpy).not.toHaveBeenCalled();
  });

  it("reports the shortest prefix when replay execution throws", () => {
    expect(() =>
      replayTrace({
        initialState: 0,
        trace: {
          schemaVersion: 1,
          entries: [
            {
              event: "advance",
              outcome: { kind: "applied", stateKey: "1", commands: [] },
            },
            {
              event: "explode",
              outcome: { kind: "applied", stateKey: "2", commands: [] },
            },
          ],
        },
        serialization: {
          schemaVersion: 1,
          serializeEvent: (event: string) => event,
          deserializeEvent: (event: string) => event,
          stateKey: String,
          describeCommand: (command: never) => command,
        },
        transition: (state, event) => {
          if (event === "explode") throw new Error("transition failed");
          return change(state + 1);
        },
      }),
    ).toThrow(/prefix 2: transition failed/);
  });

  it("reports the shortest prefix for an invalid replay result", () => {
    expect(() =>
      replayTrace({
        initialState: 0,
        trace: {
          schemaVersion: 1,
          entries: [
            {
              event: "advance",
              outcome: { kind: "applied", stateKey: "1", commands: [] },
            },
            {
              event: "invalid",
              outcome: {
                kind: "ignored",
                reason: "invalid",
                stateKey: "1",
              },
            },
          ],
        },
        serialization: {
          schemaVersion: 1,
          serializeEvent: (event: string) => event,
          deserializeEvent: (event: string) => event,
          stateKey: String,
          describeCommand: (command: never) => command,
        },
        transition: (state, event) =>
          event === "invalid"
            ? ({
                kind: "ignored",
                state,
                reason: "invalid",
                commands: ["invalid"],
              } as unknown as TransitionResult<number, never, "invalid">)
            : change(state + 1),
      }),
    ).toThrow(
      /prefix 2:[\s\S]*Ignored transitions must not emit commands[\s\S]*Explored path: \["advance"\]/,
    );
  });
});
