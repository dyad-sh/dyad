import { describe, expect, it } from "vitest";
import {
  assertReferenceStability,
  driveTransitionMatrix,
} from "@/state_machines/testing";
import type { VoiceEvent, VoiceState } from "./state";
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
  { type: "MEDIA_ACQUIRED", attempt: "stale" },
  { type: "MEDIA_DENIED", attempt: "current", message: "denied" },
  { type: "SIZE_LIMIT_REACHED", attempt: "current" },
  { type: "DURATION_ELAPSED", attempt: "current" },
  { type: "RECORDER_STOPPED", attempt: "current", hasAudio: true },
  { type: "RECORDER_STOPPED", attempt: "current", hasAudio: false },
  { type: "TRANSCRIPTION_OK", attempt: "current", text: "hello" },
  { type: "TRANSCRIPTION_FAILED", attempt: "current", message: "failed" },
];

describe("voice-to-text transition", () => {
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
    expect(result.ignoredReason).toBeUndefined();
    expect(result.commands).toEqual([
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
    expect(transcribing.commands.map((command) => command.type)).toEqual([
      "CancelDurationLimit",
      "Transcribe",
      "ReleaseMedia",
    ]);
  });
});
