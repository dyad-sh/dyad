import { describe, expect, it } from "vitest";
import {
  assertReferenceStability,
  assertAllCommandsProducible,
  assertAllStatesReachable,
  commandsOf,
  driveTransitionMatrix,
  ignoreReasonOf,
} from "@/state_machines/testing";
import type { VoiceCommand, VoiceEvent, VoiceState } from "./state";
import { transition } from "./transition";

const states: VoiceState[] = [
  { type: "idle" },
  { type: "acquiring", attempt: "current" },
  { type: "recording", attempt: "current" },
  { type: "stopping", attempt: "current", reason: "user" },
  { type: "transcribing", attempt: "current" },
];

const events: VoiceEvent[] = [
  { type: "TOGGLE", attempt: "next" },
  { type: "MEDIA_ACQUIRED", attempt: "current" },
  { type: "MEDIA_ACQUIRED", attempt: "next" },
  { type: "MEDIA_ACQUIRED", attempt: "stale" },
  { type: "MEDIA_DENIED", attempt: "current", message: "denied" },
  { type: "SIZE_LIMIT_REACHED", attempt: "current" },
  { type: "DURATION_ELAPSED", attempt: "current" },
  { type: "RECORDER_STOPPED", attempt: "current", hasAudio: true },
  { type: "RECORDER_STOPPED", attempt: "next", hasAudio: true },
  { type: "RECORDER_STOPPED", attempt: "current", hasAudio: false },
  { type: "TRANSCRIPTION_OK", attempt: "current", text: "hello" },
  { type: "TRANSCRIPTION_OK", attempt: "next", text: "hello" },
  { type: "TRANSCRIPTION_FAILED", attempt: "current", message: "failed" },
  { type: "TRANSCRIPTION_FAILED", attempt: "next", message: "failed" },
];

const STATE_KINDS = [
  "idle",
  "acquiring",
  "recording",
  "stopping",
  "transcribing",
] as const satisfies readonly VoiceState["type"][];

const COMMAND_KINDS = [
  "AcquireMedia",
  "StartRecorder",
  "StopRecorder",
  "ReleaseMedia",
  "ScheduleDurationLimit",
  "CancelDurationLimit",
  "Transcribe",
  "DeliverTranscription",
  "NotifyError",
] as const satisfies readonly VoiceCommand["type"][];

describe("voice-to-text transition", () => {
  it("reaches every state and produces every command kind", () => {
    const options = {
      initialState: { type: "idle" } as VoiceState,
      events,
      transition,
      stateKey: JSON.stringify,
    };
    assertAllStatesReachable({
      ...options,
      inventory: STATE_KINDS,
      stateKind: (state) => state.type,
    });
    assertAllCommandsProducible({
      ...options,
      inventory: COMMAND_KINDS,
      commandKind: (command) => command.type,
    });
  });
  it("is total across every flat state and event kind", () => {
    const results = driveTransitionMatrix({ states, events, transition });
    expect(results).toHaveLength(states.length * events.length);

    let index = 0;
    for (const state of states) {
      for (const _event of events) {
        assertReferenceStability(
          state,
          results[index++],
          (left, right) => JSON.stringify(left) === JSON.stringify(right),
        );
      }
    }
  });

  it("releases media acquired by a stale attempt without changing state", () => {
    const state: VoiceState = { type: "recording", attempt: "current" };
    const result = transition(state, {
      type: "MEDIA_ACQUIRED",
      attempt: "stale",
    });

    expect(result.state).toBe(state);
    expect(ignoreReasonOf(result)).toBeUndefined();
    expect(commandsOf(result)).toEqual([
      { type: "ReleaseMedia", attempt: "stale" },
    ]);
  });

  it("moves through user stop and transcription", () => {
    const recording: VoiceState = { type: "recording", attempt: "a" };
    const stopping = transition(recording, { type: "TOGGLE", attempt: "b" });
    expect(stopping.state).toEqual({
      type: "stopping",
      attempt: "a",
      reason: "user",
    });

    const transcribing = transition(stopping.state, {
      type: "RECORDER_STOPPED",
      attempt: "a",
      hasAudio: true,
    });
    expect(transcribing.state).toEqual({ type: "transcribing", attempt: "a" });
    expect(commandsOf(transcribing).map((command) => command.type)).toEqual([
      "CancelDurationLimit",
      "Transcribe",
      "ReleaseMedia",
    ]);
  });
});
