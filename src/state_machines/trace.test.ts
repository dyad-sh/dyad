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
import { observeTransition } from "./types";
import { replayTrace } from "./testing";

let sequence = 0;

function machineName(label: string): string {
  sequence += 1;
  return `trace-test-${label}-${sequence}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("machine trace observer", () => {
  it("caps each machine ring at the configured entry count", () => {
    const machine = machineName("cap");
    const observer = createTraceObserver<number, string, string>(machine, 7, {
      maxEntries: 2,
    });

    for (let value = 0; value < 3; value += 1) {
      observer.onTransitionApplied?.({
        previous: value,
        event: `event-${value}`,
        state: value + 1,
        commands: [`command-${value}`],
      });
    }

    expect(getTraceLog(machine)).toMatchObject([
      { machine, key: 7, from: 1, event: "event-1", to: 2 },
      { machine, key: 7, from: 2, event: "event-2", to: 3 },
    ]);
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

  it("redacts untagged objects from production-safe debug traces", () => {
    const machine = machineName("redacted");
    const observer = createTraceObserver<object, object, object>(machine);
    observer.onTransitionApplied?.({
      previous: { secret: "before" },
      event: { secret: "event" },
      state: { secret: "after" },
      commands: [{ secret: "command" }],
    });
    expect(getTraceLog(machine)[0]).toMatchObject({
      from: "[redacted object]",
      event: "[redacted object]",
      to: "[redacted object]",
      commands: ["[redacted object]"],
    });
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
});
