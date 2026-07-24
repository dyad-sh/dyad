import { describe, expect, it } from "vitest";
import { runCosim, type CosimResult } from "./cosim";

type ToyState =
  | { party: "sender"; phase: "idle" | "waiting" | "done" }
  | { party: "receiver"; received: boolean };

type ToyEvent =
  | { type: "start" }
  | { type: "retry" }
  | { type: "data"; attempt: 1 | 2 }
  | { type: "ack"; attempt: 1 | 2 };

type ToyCommand =
  | { type: "send-data"; attempt: 1 | 2 }
  | { type: "send-ack"; attempt: 1 | 2 };

function runToyProtocol(fixed: boolean, maxSchedules = 10_000): CosimResult {
  return runCosim<
    "sender" | "receiver",
    "data" | "ack",
    ToyState,
    ToyEvent,
    ToyCommand
  >({
    participants: {
      sender: {
        initialState: { party: "sender", phase: "idle" },
        stateKey: (state) =>
          state.party === "sender" ? `sender:${state.phase}` : "not-sender",
        eventKey: (event) =>
          "attempt" in event ? `${event.type}:${event.attempt}` : event.type,
        commandKey: (command) => `${command.type}:${command.attempt}`,
        describeEvent: (event) =>
          "attempt" in event ? `${event.type}#${event.attempt}` : event.type,
        transition: (state, event) => {
          if (state.party !== "sender") throw new Error("wrong sender state");
          if (event.type === "start" && state.phase === "idle") {
            return {
              kind: "applied",
              state: { party: "sender", phase: "waiting" },
              commands: [{ type: "send-data", attempt: 1 }],
            };
          }
          if (event.type === "retry" && state.phase === "waiting") {
            return {
              kind: "applied",
              state,
              commands: [{ type: "send-data", attempt: 2 }],
            };
          }
          if (event.type === "ack" && state.phase === "waiting") {
            return {
              kind: "applied",
              state: { party: "sender", phase: "done" },
              commands: [],
            };
          }
          return { kind: "applied", state, commands: [] };
        },
      },
      receiver: {
        initialState: { party: "receiver", received: false },
        stateKey: (state) =>
          state.party === "receiver"
            ? `receiver:${state.received}`
            : "not-receiver",
        eventKey: (event) =>
          "attempt" in event ? `${event.type}:${event.attempt}` : event.type,
        commandKey: (command) => `${command.type}:${command.attempt}`,
        describeEvent: (event) =>
          "attempt" in event ? `${event.type}#${event.attempt}` : event.type,
        transition: (state, event) => {
          if (state.party !== "receiver") {
            throw new Error("wrong receiver state");
          }
          if (event.type !== "data")
            return { kind: "applied", state, commands: [] };
          if (!state.received) {
            return {
              kind: "applied",
              state: { party: "receiver", received: true },
              commands: [{ type: "send-ack", attempt: event.attempt }],
            };
          }
          return fixed
            ? {
                kind: "applied",
                state,
                commands: [{ type: "send-ack", attempt: event.attempt }],
              }
            : { kind: "ignored", state, reason: "duplicate-data" };
        },
      },
    },
    channels: {
      data: {
        recipient: "receiver",
        eventKey: (event) =>
          "attempt" in event ? `${event.type}:${event.attempt}` : event.type,
      },
      ack: {
        recipient: "sender",
        eventKey: (event) =>
          "attempt" in event ? `${event.type}:${event.attempt}` : event.type,
      },
    },
    scenario: {
      actions: [
        {
          id: "start",
          target: "participant",
          participant: "sender",
          event: { type: "start" },
        },
        {
          id: "retry",
          target: "participant",
          participant: "sender",
          event: { type: "retry" },
          enabled: ({ participants }) =>
            participants.sender.party === "sender" &&
            participants.sender.phase === "waiting",
        },
      ],
      routeCommand: ({ command }) => {
        if (command.type === "send-data") {
          return [
            {
              target: "channel",
              channel: "data",
              event: { type: "data", attempt: command.attempt },
            },
          ];
        }
        // Seed one deterministic network loss. A correct receiver acknowledges
        // the retry too; the buggy receiver treats duplicate data as a no-op.
        if (command.attempt === 1) return [];
        return [
          {
            target: "channel",
            channel: "ack",
            event: { type: "ack", attempt: command.attempt },
          },
        ];
      },
    },
    assertions: {
      perStep: ({ transitions }) => {
        for (const transition of transitions) {
          if (transition.ignored) {
            expect(transition.result.state).toBe(transition.previousState);
          }
        }
      },
      atQuiescence: ({ participants }) => {
        expect(participants.sender).toEqual({
          party: "sender",
          phase: "done",
        });
      },
    },
    maxSchedules,
  });
}

const LOST_ACK_TRACE = [
  'inject "start": send start to "sender"',
  'inject "retry": send retry to "sender"',
  'execute "sender" command: send-data:1 => enqueue data:1 on "data"',
  'deliver "data" to "receiver": data:1',
  'execute "sender" command: send-data:2 => enqueue data:2 on "data"',
  'deliver "data" to "receiver": data:2 (ignored)',
  'execute "receiver" command: send-ack:1 => no follow-up (dropped)',
];

describe("interleaving co-simulation", () => {
  it("finds the minimal trace for a seeded lost-ack bug", () => {
    const result = runToyProtocol(false);

    expect(result.exhaustive).toBe(true);
    expect(result.failure?.phase).toBe("quiescence");
    expect(result.failure?.trace).toEqual(LOST_ACK_TRACE);
    expect(result.failure?.formattedTrace).toContain(
      "Co-simulation quiescence assertion failed",
    );
    expect(result.failure?.formattedTrace).toContain(
      '6. deliver "data" to "receiver": data:2 (ignored)',
    );
    expect(result.failure?.formattedTrace).toContain(
      '7. execute "receiver" command: send-ack:1 => no follow-up (dropped)',
    );
  });

  it("passes the fixed protocol exhaustively with a stable schedule count", () => {
    const result = runToyProtocol(true);

    expect(result.failure).toBeUndefined();
    expect(result.exhaustive).toBe(true);
    expect(result.boundReached).toBe(false);
    expect(result.schedulesExplored).toBe(16);
    expect(result.quiescentSchedules).toBeGreaterThan(0);
  });

  it("renders deterministic failing traces", () => {
    expect(runToyProtocol(false).failure?.formattedTrace).toBe(
      runToyProtocol(false).failure?.formattedTrace,
    );
  });

  it("respects and surfaces the maxSchedules bound", () => {
    const result = runToyProtocol(true, 3);

    expect(result.schedulesExplored).toBe(3);
    expect(result.boundReached).toBe(true);
    expect(result.exhaustive).toBe(false);
  });

  it("drains configurations admitted before reaching the bound", () => {
    type State = "initial" | "after-first" | "failing" | "combined";
    type Event = "first" | "fail";

    const result = runCosim<"participant", never, State, Event, never>({
      participants: {
        participant: {
          initialState: "initial",
          stateKey: (state) => state,
          eventKey: (event) => event,
          commandKey: (command) => command,
          transition: (state, event) => ({
            kind: "applied",
            state:
              event === "first"
                ? "after-first"
                : state === "after-first"
                  ? "combined"
                  : "failing",
            commands: [],
          }),
        },
      },
      channels: {},
      scenario: {
        actions: [
          {
            id: "first",
            target: "participant",
            participant: "participant",
            event: "first",
            enabled: ({ participants }) =>
              participants.participant === "initial",
          },
          {
            id: "fail",
            target: "participant",
            participant: "participant",
            event: "fail",
          },
        ],
        routeCommand: () => [],
      },
      assertions: {
        atQuiescence: ({ participants }) => {
          expect(participants.participant).not.toBe("failing");
        },
      },
      maxSchedules: 3,
    });

    expect(result.schedulesExplored).toBe(3);
    expect(result.boundReached).toBe(true);
    expect(result.failure?.phase).toBe("quiescence");
    expect(result.failure?.trace).toEqual([
      'inject "fail": send fail to "participant"',
    ]);
  });

  it("uses participant event keys when descriptions are omitted", () => {
    const result = runCosim<
      "participant",
      never,
      boolean,
      { type: "start" },
      never
    >({
      participants: {
        participant: {
          initialState: false,
          stateKey: String,
          eventKey: (event) => event.type,
          commandKey: (command) => command,
          transition: () => ({ kind: "applied", state: true, commands: [] }),
        },
      },
      channels: {},
      scenario: {
        actions: [
          {
            id: "start",
            target: "participant",
            participant: "participant",
            event: { type: "start" },
          },
        ],
        routeCommand: () => [],
      },
      assertions: {
        atQuiescence: () => {
          throw new Error("capture trace");
        },
      },
    });

    expect(result.failure?.trace).toEqual([
      'inject "start": send start to "participant"',
    ]);
  });

  it("isolates the search from mutations in caller snapshots", () => {
    const initialState = { value: 0 };
    const result = runCosim<
      "participant",
      never,
      { value: number },
      "advance",
      "finish"
    >({
      participants: {
        participant: {
          initialState,
          stateKey: (state) => String(state.value),
          eventKey: (event) => event,
          commandKey: (command) => command,
          transition: (state) => ({
            kind: "applied",
            state: { value: state.value + 1 },
            commands: ["finish"],
          }),
        },
      },
      channels: {},
      scenario: {
        actions: [
          {
            id: "advance",
            target: "participant",
            participant: "participant",
            event: "advance",
            enabled: (snapshot) => {
              snapshot.participants.participant.value = 99;
              return true;
            },
          },
        ],
        routeCommand: (_source, snapshot) => {
          snapshot.participants.participant.value = 99;
          return [];
        },
      },
      assertions: {
        perStep: (step) => {
          step.snapshot.participants.participant.value = 99;
          if (step.transitions[0]) {
            step.transitions[0].result.state.value = 99;
          }
        },
        atQuiescence: (snapshot) => {
          expect(snapshot.participants.participant.value).toBe(1);
          snapshot.participants.participant.value = 99;
        },
      },
    });

    expect(result.failure).toBeUndefined();
    expect(initialState).toEqual({ value: 0 });
  });

  it("rejects a transition result without state before exploring it", () => {
    const result = runCosim<"participant", never, number, "advance", never>({
      participants: {
        participant: {
          initialState: 0,
          stateKey: String,
          eventKey: (event) => event,
          commandKey: (command) => command,
          transition: () => ({ kind: "applied", commands: [] }) as never,
        },
      },
      channels: {},
      scenario: {
        actions: [
          {
            id: "advance",
            target: "participant",
            participant: "participant",
            event: "advance",
          },
        ],
        routeCommand: () => [],
      },
    });

    expect(result.failure).toMatchObject({
      phase: "driver",
      trace: [],
    });
    expect(result.failure?.message).toContain("invalid transition result");
  });
});
