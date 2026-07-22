/**
 * Voice capture is input-scoped: each hook mount owns exactly one controller.
 * Attempt IDs correlate every asynchronous browser/IPC completion. A result
 * from an older attempt may release its own media, but never changes the live
 * attempt's state. Commands may finish concurrently, while a live controller
 * drains their events FIFO. Stale MEDIA_ACQUIRED must never be dropped because
 * its stream needs releasing; other stale attempt completions may be ignored.
 * Disposal intentionally discards every queued or late event after running
 * resource-cleanup commands.
 */

export type VoiceStopReason = "user" | "duration" | "size";

export type VoiceState =
  | { type: "idle" }
  | { type: "acquiring"; attempt: string }
  | { type: "recording"; attempt: string }
  | { type: "stopping"; attempt: string; reason: VoiceStopReason }
  | { type: "transcribing"; attempt: string };

export type VoiceEvent =
  | { type: "TOGGLE"; attempt: string }
  | { type: "MEDIA_ACQUIRED"; attempt: string }
  | { type: "MEDIA_DENIED"; attempt: string; message: string }
  | { type: "SIZE_LIMIT_REACHED"; attempt: string }
  | { type: "DURATION_ELAPSED"; attempt: string }
  | { type: "RECORDER_STOPPED"; attempt: string; hasAudio: boolean }
  | { type: "TRANSCRIPTION_OK"; attempt: string; text: string }
  | { type: "TRANSCRIPTION_FAILED"; attempt: string; message: string };

export type VoiceCommand =
  | { type: "AcquireMedia"; attempt: string }
  | { type: "StartRecorder"; attempt: string }
  | { type: "StopRecorder"; attempt: string; reason: VoiceStopReason | null }
  | { type: "ReleaseMedia"; attempt: string }
  | { type: "ScheduleDurationLimit"; attempt: string }
  | { type: "CancelDurationLimit"; attempt: string }
  | { type: "Transcribe"; attempt: string }
  | { type: "DeliverTranscription"; text: string }
  | { type: "NotifyError"; message: string };

export type VoiceIgnoreReason =
  | "start-in-flight"
  | "busy"
  | "invalid-in-current-state"
  | "stale-attempt";

export type VoiceTransitionResult =
  import("@/state_machines/types").TransitionResult<
    VoiceState,
    VoiceCommand,
    VoiceIgnoreReason
  >;
