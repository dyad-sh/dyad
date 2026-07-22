import { describe, expect, it } from "vitest";

import {
  runCosim,
  type CosimScenarioAction,
  type CosimSnapshot,
  type CosimStep,
} from "@/state_machines/cosim";
import type {
  StreamCommand,
  StreamEvent,
  StreamRequest,
  StreamState,
} from "../state";
import {
  initialStreamState,
  isStreamActive,
  streamGeneration,
  transition,
} from "../transition";
import {
  assertMainModelQuiescence,
  assertMainModelTransitionInvariants,
  initialMainModelState,
  transitionMainModel,
  type MainModelEmission,
  type MainModelEvent,
  type MainModelState,
} from "../main_model";
import { CHAT_STREAM_WIRE_EVENTS } from "../protocol";

/**
 * Bounded exhaustive alphabet: one chat, two total submits (the second queues),
 * one cancel, one chat barrier pair, and one app barrier pair. Quit and error
 * paths use separate exhaustive alphabets below so lifecycle coverage stays
 * below the 300,000-configuration / ~30 second budget instead of raising the
 * landed driver's maxSchedules bound. Resume actions are phase-enabled; the
 * bound counts configurations, not quiescent leaves.
 */

type ParticipantName = "main" | "renderer" | "scenario";
type ChannelName = "main-to-renderer";

interface ScenarioState {
  queued: StreamRequest[];
  dispatchesByGeneration: Readonly<Record<number, number>>;
  finalizeScheduled: readonly number[];
}

type State =
  | { participant: "main"; value: MainModelState }
  | { participant: "renderer"; value: StreamState }
  | { participant: "scenario"; value: ScenarioState };

type Event =
  | { participant: "main"; value: MainModelEvent }
  | { participant: "renderer"; value: StreamEvent }
  | {
      participant: "scenario";
      value:
        | { type: "enqueue"; request: StreamRequest }
        | { type: "dispatch"; generation: number }
        | { type: "schedule-finalize"; streamId: number; ok: boolean };
    };

type Command =
  | { participant: "main"; value: MainModelEmission }
  | { participant: "renderer"; value: StreamCommand }
  | {
      participant: "scenario";
      value:
        | { type: "submit-queued"; request: StreamRequest }
        | { type: "deliver-finalize"; streamId: number; ok: boolean };
    };

type Snapshot = CosimSnapshot<
  ParticipantName,
  ChannelName,
  State,
  Event,
  Command
>;
type Step = CosimStep<ParticipantName, ChannelName, State, Event, Command>;
type Action = CosimScenarioAction<
  ParticipantName,
  ChannelName,
  State,
  Event,
  Command
>;

const request = (prompt: string): StreamRequest => ({
  prompt,
  chatId: 7,
  appId: 9,
});
const rendererEvent = (value: StreamEvent): Event => ({
  participant: "renderer",
  value,
});
const mainEvent = (value: MainModelEvent): Event => ({
  participant: "main",
  value,
});

function participantValue(snapshot: Snapshot, name: "main"): MainModelState;
function participantValue(snapshot: Snapshot, name: "renderer"): StreamState;
function participantValue(snapshot: Snapshot, name: "scenario"): ScenarioState;
function participantValue(
  snapshot: Snapshot,
  name: ParticipantName,
): MainModelState | StreamState | ScenarioState {
  const state = snapshot.participants[name];
  if (state.participant !== name)
    throw new Error(`Invalid ${name} participant state`);
  return state.value;
}

function wrapRendererTransition(
  rendererTransition: typeof transition,
): (
  state: State,
  event: Event,
) => { state: State; commands: readonly Command[] } {
  return (state, event) => {
    if (state.participant !== "renderer" || event.participant !== "renderer") {
      return { state, commands: [] };
    }
    // This is the production transition itself; wrapping only tags the common
    // driver union and does not alter states, events, commands, or ignores.
    const result = rendererTransition(state.value, event.value);
    return {
      state:
        result.state === state.value
          ? state
          : { participant: "renderer", value: result.state },
      commands: result.commands.map(
        (value) => ({ participant: "renderer", value }) as const,
      ),
    };
  };
}

function scenarioTransition(
  state: State,
  event: Event,
): { state: State; commands: readonly Command[] } {
  if (state.participant !== "scenario" || event.participant !== "scenario") {
    return { state, commands: [] };
  }
  switch (event.value.type) {
    case "enqueue":
      return {
        state: {
          participant: "scenario",
          value: {
            ...state.value,
            queued: [...state.value.queued, event.value.request],
          },
        },
        commands: [],
      };
    case "dispatch": {
      const count =
        (state.value.dispatchesByGeneration[event.value.generation] ?? 0) + 1;
      const next = state.value.queued[0];
      return {
        state: {
          participant: "scenario",
          value: {
            ...state.value,
            queued: next ? state.value.queued.slice(1) : state.value.queued,
            dispatchesByGeneration: {
              ...state.value.dispatchesByGeneration,
              [event.value.generation]: count,
            },
          },
        },
        commands: next
          ? [
              {
                participant: "scenario",
                value: { type: "submit-queued", request: next },
              },
            ]
          : [],
      };
    }
    case "schedule-finalize":
      return {
        state: {
          participant: "scenario",
          value: {
            ...state.value,
            finalizeScheduled: [
              ...state.value.finalizeScheduled,
              event.value.streamId,
            ],
          },
        },
        commands: [
          {
            participant: "scenario",
            value: {
              type: "deliver-finalize",
              streamId: event.value.streamId,
              ok: event.value.ok,
            },
          },
        ],
      };
  }
}

function mainTransition(state: State, event: Event) {
  if (state.participant !== "main" || event.participant !== "main") {
    return { state, commands: [] };
  }
  const result = transitionMainModel(state.value, event.value);
  assertMainModelTransitionInvariants(state.value, event.value, result);
  return {
    state:
      result.state === state.value
        ? state
        : { participant: "main" as const, value: result.state },
    commands: result.commands.map((value) => ({
      participant: "main" as const,
      value,
    })),
  };
}

function emissionToRenderer(
  emission: MainModelEmission,
): StreamEvent | undefined {
  switch (emission.type) {
    case CHAT_STREAM_WIRE_EVENTS.start:
      return { type: "registered", streamId: emission.payload.streamId };
    case CHAT_STREAM_WIRE_EVENTS.chunk:
      return {
        type: "chunk-received",
        streamId: emission.payload.streamId ?? 0,
      };
    case CHAT_STREAM_WIRE_EVENTS.end:
      return {
        type: "stream-ended",
        streamId: emission.payload.streamId ?? 0,
        response: emission.payload,
      };
    case CHAT_STREAM_WIRE_EVENTS.error:
      return {
        type: "stream-errored",
        streamId: emission.payload.streamId ?? 0,
        error: emission.payload.error,
        warningMessages: emission.payload.warningMessages,
      };
    case CHAT_STREAM_WIRE_EVENTS.transportEnd:
    case "completion-resolved":
      return undefined;
  }
}

function routeCommand(
  source: { participant: ParticipantName; command: Command },
  snapshot: Snapshot,
) {
  const command = source.command;
  if (command.participant === "main") {
    const mapped = emissionToRenderer(command.value);
    return mapped
      ? [
          {
            target: "channel" as const,
            channel: "main-to-renderer" as const,
            event: rendererEvent(mapped),
          },
        ]
      : [];
  }
  if (command.participant === "scenario") {
    return command.value.type === "submit-queued"
      ? [
          {
            target: "participant" as const,
            participant: "renderer" as const,
            event: rendererEvent({
              type: "submit",
              request: command.value.request,
            }),
          },
        ]
      : [
          {
            target: "participant" as const,
            participant: "renderer" as const,
            event: rendererEvent({
              type: "finalize-complete",
              streamId: command.value.streamId,
              ok: command.value.ok,
            }),
          },
        ];
  }

  const value = command.value;
  switch (value.type) {
    case "start-stream":
      return [
        {
          target: "participant" as const,
          participant: "main" as const,
          event: mainEvent({
            type: "request-received",
            streamId: value.streamId,
            chatId: 7,
            appId: 9,
          }),
        },
      ];
    case "request-abort":
      return [
        {
          target: "participant" as const,
          participant: "main" as const,
          event: mainEvent({ type: "cancel-chat", chatId: 7 }),
        },
      ];
    case "enqueue-message":
      return [
        {
          target: "participant" as const,
          participant: "scenario" as const,
          event: {
            participant: "scenario" as const,
            value: { type: "enqueue" as const, request: value.request },
          },
        },
      ];
    case "dispatch-next-queued": {
      const renderer = participantValue(snapshot, "renderer");
      const generation = streamGeneration(renderer);
      return [
        {
          target: "participant" as const,
          participant: "scenario" as const,
          event: {
            participant: "scenario" as const,
            value: { type: "dispatch" as const, generation },
          },
        },
      ];
    }
    case "run-end-side-effects":
      // The scenario participant deliberately schedules finalize delivery as a
      // second command step, preserving the production await/interleaving gap.
      return [
        {
          target: "participant" as const,
          participant: "scenario" as const,
          event: {
            participant: "scenario" as const,
            value: {
              type: "schedule-finalize" as const,
              streamId: value.streamId,
              ok: true,
            },
          },
        },
      ];
    case "run-error-side-effects":
      return [];
  }
}

function phase(snapshot: Snapshot, streamId: number): string | undefined {
  return participantValue(snapshot, "main").streams[streamId]?.phase;
}

function actions(fullAlphabet: boolean): Action[] {
  const result: Action[] = [
    {
      id: "submit-1",
      target: "participant",
      participant: "renderer",
      event: rendererEvent({ type: "submit", request: request("first") }),
    },
    {
      id: "cancel",
      target: "participant",
      participant: "renderer",
      event: rendererEvent({ type: "cancel" }),
      enabled: (snapshot) =>
        isStreamActive(participantValue(snapshot, "renderer")),
    },
  ];
  if (!fullAlphabet) return result;

  result.push(
    {
      id: "submit-2-queued",
      target: "participant",
      participant: "renderer",
      event: rendererEvent({ type: "submit", request: request("queued") }),
      enabled: (snapshot) =>
        isStreamActive(participantValue(snapshot, "renderer")) ||
        participantValue(snapshot, "renderer").type === "finalizing",
    },
    {
      id: "install-chat-barrier",
      target: "participant",
      participant: "main",
      event: mainEvent({
        type: "barrier-installed",
        scope: { type: "chat", chatId: 7 },
      }),
      enabled: (snapshot) =>
        participantValue(snapshot, "main").streams[1] !== undefined,
    },
    {
      id: "release-chat-barrier",
      target: "participant",
      participant: "main",
      event: mainEvent({
        type: "barrier-released",
        scope: { type: "chat", chatId: 7 },
      }),
      enabled: (snapshot) =>
        (participantValue(snapshot, "main").chatBarrierCounts[7] ?? 0) > 0,
    },
    {
      id: "install-app-barrier",
      target: "participant",
      participant: "main",
      event: mainEvent({
        type: "barrier-installed",
        scope: { type: "app", appId: 9 },
      }),
      enabled: (snapshot) =>
        participantValue(snapshot, "main").streams[1] !== undefined,
    },
    {
      id: "release-app-barrier",
      target: "participant",
      participant: "main",
      event: mainEvent({
        type: "barrier-released",
        scope: { type: "app", appId: 9 },
      }),
      enabled: (snapshot) =>
        (participantValue(snapshot, "main").appBarrierCounts[9] ?? 0) > 0,
    },
  );

  for (const streamId of [1, 2]) {
    // Seven ordered resume tokens cover initial tracking, both barrier
    // re-loops, admission/body entry, and the two post-abort-check awaits.
    for (let index = 0; index < 7; index += 1) {
      const id = `advance-${streamId}-${index}`;
      result.push({
        id,
        target: "participant",
        participant: "main",
        event: mainEvent({ type: "handler-advanced", streamId }),
        enabled: (snapshot) => {
          const current = phase(snapshot, streamId);
          const nextResume = snapshot.remainingActionIds.find((candidate) =>
            candidate.startsWith(`advance-${streamId}-`),
          );
          if (nextResume !== id) return false;
          if (
            current === "tracked" ||
            current === "admission-pending" ||
            current === "admitted"
          )
            return true;
          const awaitPoint = participantValue(snapshot, "main").streams[
            streamId
          ]?.awaitPoint;
          return (
            current === "streaming" &&
            (awaitPoint === "post-abort-db" ||
              awaitPoint === "post-abort-apply")
          );
        },
      });
    }
    result.push(
      {
        id: `settle-${streamId}`,
        target: "participant",
        participant: "main",
        event: mainEvent({
          type: "llm-settled",
          streamId,
          outcome: "completed",
        }),
        enabled: (snapshot) =>
          phase(snapshot, streamId) === "streaming" &&
          participantValue(snapshot, "main").streams[streamId]?.awaitPoint ===
            "llm",
      },
      {
        id: `unwind-${streamId}`,
        target: "participant",
        participant: "main",
        event: mainEvent({ type: "handler-unwound", streamId }),
        enabled: (snapshot) =>
          phase(snapshot, streamId)?.startsWith("unwinding-") === true,
      },
    );
  }
  return result;
}

type ErrorScenario = "llm-error" | "post-guard-error" | "apply-error";

function errorActions(scenario: ErrorScenario): Action[] {
  const result: Action[] = [
    {
      id: "submit-error-stream",
      target: "participant",
      participant: "renderer",
      event: rendererEvent({ type: "submit", request: request(scenario) }),
    },
  ];
  for (let index = 0; index < 3; index += 1) {
    const id = `enter-streaming-${index}`;
    result.push({
      id,
      target: "participant",
      participant: "main",
      event: mainEvent({ type: "handler-advanced", streamId: 1 }),
      enabled: (snapshot) => {
        const nextResume = snapshot.remainingActionIds.find((candidate) =>
          candidate.startsWith("enter-streaming-"),
        );
        return (
          nextResume === id &&
          ["tracked", "admission-pending", "admitted"].includes(
            phase(snapshot, 1) ?? "",
          )
        );
      },
    });
  }
  if (scenario === "llm-error") {
    result.push({
      id: "llm-error",
      target: "participant",
      participant: "main",
      event: mainEvent({
        type: "llm-settled",
        streamId: 1,
        outcome: "errored",
      }),
      enabled: (snapshot) =>
        participantValue(snapshot, "main").streams[1]?.awaitPoint === "llm",
    });
  } else {
    result.push(
      {
        id: "llm-completed",
        target: "participant",
        participant: "main",
        event: mainEvent({
          type: "llm-settled",
          streamId: 1,
          outcome: "completed",
        }),
        enabled: (snapshot) =>
          participantValue(snapshot, "main").streams[1]?.awaitPoint === "llm",
      },
      {
        id: "finish-post-guard-db",
        target: "participant",
        participant: "main",
        event: mainEvent({ type: "handler-advanced", streamId: 1 }),
        enabled: (snapshot) =>
          participantValue(snapshot, "main").streams[1]?.awaitPoint ===
          "post-abort-db",
      },
    );
    if (scenario === "post-guard-error") {
      result.push({
        id: "cancel-after-guard",
        target: "participant",
        participant: "renderer",
        event: rendererEvent({ type: "cancel" }),
        enabled: (snapshot) =>
          participantValue(snapshot, "main").streams[1]?.awaitPoint ===
            "post-abort-apply" &&
          isStreamActive(participantValue(snapshot, "renderer")),
      });
    }
    result.push({
      id: scenario,
      target: "participant",
      participant: "main",
      event: mainEvent({
        type: "handler-advanced",
        streamId: 1,
        throws: scenario === "post-guard-error",
        applyError: scenario === "apply-error",
      }),
      enabled: (snapshot) => {
        const stream = participantValue(snapshot, "main").streams[1];
        return (
          stream?.awaitPoint === "post-abort-apply" &&
          (scenario !== "post-guard-error" || stream.aborted)
        );
      },
    });
  }
  result.push({
    id: "unwind-error-stream",
    target: "participant",
    participant: "main",
    event: mainEvent({ type: "handler-unwound", streamId: 1 }),
    enabled: (snapshot) =>
      phase(snapshot, 1)?.startsWith("unwinding-") === true,
  });
  return result;
}

function quitWhileActiveActions(): Action[] {
  return [
    ...errorActions("llm-error").filter(
      (action) =>
        action.id !== "llm-error" && action.id !== "unwind-error-stream",
    ),
    {
      id: "quit-mid-stream",
      target: "participant",
      participant: "main",
      event: mainEvent({ type: "quit" }),
      enabled: (snapshot) => phase(snapshot, 1) === "streaming",
    },
  ];
}

function perStepAssertions(step: Step): void {
  for (const item of step.transitions) {
    if (
      item.participant === "main" &&
      item.previousState.participant === "main" &&
      item.event.participant === "main"
    ) {
      const value = item.result.state;
      if (value.participant !== "main")
        throw new Error("main participant changed kind");
      assertMainModelTransitionInvariants(
        item.previousState.value,
        item.event.value,
        {
          state: value.value,
          commands: item.result.commands
            .filter(
              (command): command is Extract<Command, { participant: "main" }> =>
                command.participant === "main",
            )
            .map((command) => command.value),
        },
      );
    }
    if (
      item.participant === "renderer" &&
      item.previousState.participant === "renderer" &&
      item.event.participant === "renderer"
    ) {
      const event = item.event.value;
      if (event.type !== "stream-ended" && event.type !== "stream-errored")
        continue;
      const previous = item.previousState.value;
      const generation = streamGeneration(previous);
      if (event.streamId !== generation) continue;
      const wasActive = isStreamActive(previous);
      if (wasActive && item.result.state === item.previousState) {
        throw new Error(
          "the first terminal for the current generation did not advance the renderer",
        );
      }
      if (!wasActive && item.result.state !== item.previousState) {
        throw new Error(
          "a duplicate terminal for the current generation changed renderer state",
        );
      }
    }
  }
  const scenario = participantValue(step.snapshot, "scenario");
  if (
    Object.values(scenario.dispatchesByGeneration).some((count) => count > 1)
  ) {
    throw new Error(
      "more than one dispatch-next-queued occurred for a generation",
    );
  }
}

function run(
  rendererTransition: typeof transition,
  scenarioActions: Action[],
  maxSchedules: number,
  expectedRendererState?: "idle" | "errored",
) {
  return runCosim<ParticipantName, ChannelName, State, Event, Command>({
    participants: {
      main: {
        initialState: { participant: "main", value: initialMainModelState },
        transition: mainTransition,
        stateKey: JSON.stringify,
        eventKey: JSON.stringify,
        commandKey: JSON.stringify,
      },
      renderer: {
        initialState: { participant: "renderer", value: initialStreamState() },
        transition: wrapRendererTransition(rendererTransition),
        stateKey: JSON.stringify,
        eventKey: JSON.stringify,
        commandKey: JSON.stringify,
      },
      scenario: {
        initialState: {
          participant: "scenario",
          value: {
            queued: [],
            dispatchesByGeneration: {},
            finalizeScheduled: [],
          },
        },
        transition: scenarioTransition,
        stateKey: JSON.stringify,
        eventKey: JSON.stringify,
        commandKey: JSON.stringify,
      },
    },
    channels: {
      "main-to-renderer": { recipient: "renderer", eventKey: JSON.stringify },
    },
    scenario: { actions: scenarioActions, routeCommand },
    assertions: {
      perStep: perStepAssertions,
      atQuiescence: (snapshot) => {
        const renderer = participantValue(snapshot, "renderer");
        const main = participantValue(snapshot, "main");
        if (!main.quit) {
          if (renderer.type !== "idle" && renderer.type !== "errored") {
            throw new Error(`renderer quiesced in ${renderer.type}`);
          }
          if (isStreamActive(renderer))
            throw new Error("renderer quiesced with isStreamActive=true");
          if (
            expectedRendererState &&
            renderer.type !== expectedRendererState
          ) {
            throw new Error(
              `renderer quiesced in ${renderer.type}, expected ${expectedRendererState}`,
            );
          }
        }
        assertMainModelQuiescence(main);
      },
    },
    maxSchedules,
  });
}

describe("chat stream main/renderer co-simulation", () => {
  it("exhausts the bounded stream, queue, cancel, and barrier alphabet", () => {
    const result = run(transition, actions(true), 300_000);
    expect(result.failure, result.failure?.formattedTrace).toBeUndefined();
    expect(result.exhaustive).toBe(true);
    expect(result.quiescentSchedules).toBeGreaterThan(0);
  }, 30_000);

  it("regresses #4008: cancel before registration still finalizes", () => {
    const result = run(transition, actions(false), 1_000);
    expect(result.failure, result.failure?.formattedTrace).toBeUndefined();
  });

  it("exhausts quit interleavings while the renderer is still active", () => {
    const result = run(transition, quitWhileActiveActions(), 5_000);
    expect(result.failure, result.failure?.formattedTrace).toBeUndefined();
    expect(result.exhaustive).toBe(true);
    expect(result.quiescentSchedules).toBeGreaterThan(0);
  });

  it("self-tests the harness with the pre-3ac500962 registered-gated mutant", () => {
    const mutant: typeof transition = (state, event) => {
      if (
        state.type === "cancelling" &&
        !state.registered &&
        event.type === "stream-ended" &&
        event.streamId === state.streamId
      ) {
        return { state, commands: [], ignoredReason: "already-cancelling" };
      }
      return transition(state, event);
    };
    const result = run(mutant, actions(false), 1_000);
    expect(result.failure?.message).toContain(
      "the first terminal for the current generation did not advance",
    );
    expect(result.failure?.trace.join("\n")).toContain("cancel");
    expect(result.failure?.trace.length).toBeLessThanOrEqual(8);
  });

  it.each([
    ["llm-error", "errored"],
    ["post-guard-error", "idle"],
    ["apply-error", "errored"],
  ] as const)(
    "co-simulates the %s terminal path to renderer %s",
    (scenario, expectedRendererState) => {
      const result = run(
        transition,
        errorActions(scenario),
        5_000,
        expectedRendererState,
      );
      expect(result.failure, result.failure?.formattedTrace).toBeUndefined();
      expect(result.quiescentSchedules).toBeGreaterThan(0);
    },
  );
});
