import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PreviewCommand,
  PreviewEvent,
  PreviewState,
} from "@/version_preview/state";
import { CLOSED_STATE } from "@/version_preview/state";
import { transition } from "@/version_preview/transition";
import { createTraceObserver, getTraceLog } from "./trace";
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

  it("retains events that can be replayed through a pure transition", () => {
    const machine = machineName("replay");
    const observer = createTraceObserver<
      PreviewState,
      PreviewEvent,
      PreviewCommand
    >(machine, undefined, {
      describeState: (state) => state,
      describeEvent: (event) => event,
      describeCommand: (command) => command,
    });
    const events: PreviewEvent[] = [
      { type: "OPEN", appId: 7 },
      { type: "SELECT_VERSION", versionId: "version-1" },
      { type: "ORIGIN_RESOLVED", branch: "main" },
    ];

    let state = CLOSED_STATE;
    for (const event of events) {
      const result = transition(state, event);
      observer.onTransitionApplied?.({
        previous: state,
        event,
        state: result.state,
        commands: result.commands,
      });
      state = result.state;
    }

    const replayed = replayTrace({
      initialState: CLOSED_STATE,
      entries: getTraceLog(machine) as readonly { event: PreviewEvent }[],
      transition,
    });
    expect(replayed).toEqual(state);
  });
});
