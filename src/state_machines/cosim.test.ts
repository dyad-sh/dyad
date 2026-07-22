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
        commandKey: (command) => `${command.type}:${command.attempt}`,
        describeEvent: (event) =>
          "attempt" in event ? `${event.type}#${event.attempt}` : event.type,
        transition: (state, event) => {
          if (state.party !== "sender") throw new Error("wrong sender state");
          if (event.type === "start" && state.phase === "idle") {
            return {
              state: { party: "sender", phase: "waiting" },
              commands: [{ type: "send-data", attempt: 1 }],
            };
          }
          if (event.type === "retry" && state.phase === "waiting") {
            return {
              state,
              commands: [{ type: "send-data", attempt: 2 }],
            };
          }
          if (event.type === "ack" && state.phase === "waiting") {
            return {
              state: { party: "sender", phase: "done" },
              commands: [],
            };
          }
          return { state, commands: [] };
        },
      },
      receiver: {
        initialState: { party: "receiver", received: false },
        stateKey: (state) =>
          state.party === "receiver"
            ? `receiver:${state.received}`
            : "not-receiver",
        commandKey: (command) => `${command.type}:${command.attempt}`,
        describeEvent: (event) =>
          "attempt" in event ? `${event.type}#${event.attempt}` : event.type,
        transition: (state, event) => {
          if (state.party !== "receiver") {
            throw new Error("wrong receiver state");
          }
          if (event.type !== "data") return { state, commands: [] };
          if (!state.received) {
            return {
              state: { party: "receiver", received: true },
              commands: [{ type: "send-ack", attempt: event.attempt }],
            };
          }
          return {
            state,
            commands: fixed
              ? [{ type: "send-ack", attempt: event.attempt }]
              : [],
          };
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
            expect(transition.result.commands).toHaveLength(0);
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
});
