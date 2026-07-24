import { ipc } from "@/ipc/types";
import {
  AUDIO_RECORDING_TIMESLICE_MS,
  MAX_AUDIO_RECORDING_BYTES,
  MAX_AUDIO_RECORDING_DURATION_MS,
} from "@/ipc/types/audio";
import type { Clock, IdSource } from "@/state_machines/clock";
import { TimerLeaseScope } from "@/state_machines/timer_lease";
import type { VoiceCommandRunner } from "./controller";
import type { VoiceCommand, VoiceEvent } from "./state";

export interface VoiceCallbacks {
  onTranscription(text: string): void;
  onError?(message: string): void;
}

export interface BrowserVoiceCommandRunner extends VoiceCommandRunner {
  updateCallbacks(callbacks: VoiceCallbacks): void;
}

interface AttemptResources {
  stream: MediaStream;
  recorder?: MediaRecorder;
  chunks: Blob[];
  recordedBytes: number;
}

export function createBrowserVoiceCommandRunner(options: {
  clock: Clock;
  idSource: IdSource;
  callbacks: VoiceCallbacks;
}): BrowserVoiceCommandRunner {
  const attempts = new Map<string, AttemptResources>();
  const pendingAcquisitions = new Set<string>();
  const releasedAttempts = new Set<string>();
  const cancelledAttempts = new Set<string>();
  let callbacks = options.callbacks;
  let emitEvent: (event: VoiceEvent) => void = () => undefined;
  const durationLeases = new TimerLeaseScope<string, string, VoiceEvent>(
    options.clock,
    (event) => emitEvent(event),
  );

  function emitFailure(
    emit: (event: VoiceEvent) => void,
    attempt: string,
    error: unknown,
    fallback: string,
  ) {
    emit({
      type: "MEDIA_DENIED",
      attempt,
      message: error instanceof Error ? error.message : fallback,
    });
  }

  function cancelDuration(attempt: string) {
    durationLeases.remove(attempt);
  }

  function release(attempt: string) {
    const resources = attempts.get(attempt);
    if (!resources) {
      if (pendingAcquisitions.has(attempt)) releasedAttempts.add(attempt);
      return;
    }
    cancelDuration(attempt);
    resources.stream.getTracks().forEach((track) => track.stop());
    attempts.delete(attempt);
  }

  function run(command: VoiceCommand, emit: (event: VoiceEvent) => void) {
    emitEvent = emit;
    switch (command.type) {
      case "AcquireMedia":
        pendingAcquisitions.add(command.attempt);
        void navigator.mediaDevices.getUserMedia({ audio: true }).then(
          (stream) => {
            pendingAcquisitions.delete(command.attempt);
            if (releasedAttempts.delete(command.attempt)) {
              stream.getTracks().forEach((track) => track.stop());
              return;
            }
            attempts.set(command.attempt, {
              stream,
              chunks: [],
              recordedBytes: 0,
            });
            emit({ type: "MEDIA_ACQUIRED", attempt: command.attempt });
          },
          (error) => {
            pendingAcquisitions.delete(command.attempt);
            releasedAttempts.delete(command.attempt);
            emitFailure(
              emit,
              command.attempt,
              error,
              "Failed to access microphone",
            );
          },
        );
        return;

      case "StartRecorder": {
        const resources = attempts.get(command.attempt);
        if (!resources) {
          emitFailure(
            emit,
            command.attempt,
            new Error("Microphone stream is unavailable"),
            "Failed to access microphone",
          );
          return;
        }
        try {
          const recorder = new MediaRecorder(resources.stream, {
            mimeType: "audio/webm",
          });
          resources.recorder = recorder;
          recorder.ondataavailable = (event) => {
            if (event.data.size === 0) return;
            const nextBytes = resources.recordedBytes + event.data.size;
            if (nextBytes > MAX_AUDIO_RECORDING_BYTES) {
              emit({
                type: "SIZE_LIMIT_REACHED",
                attempt: command.attempt,
              });
              return;
            }
            resources.chunks.push(event.data);
            resources.recordedBytes = nextBytes;
            if (nextBytes >= MAX_AUDIO_RECORDING_BYTES) {
              emit({
                type: "SIZE_LIMIT_REACHED",
                attempt: command.attempt,
              });
            }
          };
          recorder.onstop = () => {
            resources.recorder = undefined;
            emit({
              type: "RECORDER_STOPPED",
              attempt: command.attempt,
              hasAudio: resources.recordedBytes > 0,
            });
          };
          recorder.start(AUDIO_RECORDING_TIMESLICE_MS);
        } catch (error) {
          emitFailure(
            emit,
            command.attempt,
            error,
            "Failed to access microphone",
          );
        }
        return;
      }

      case "StopRecorder": {
        if (command.reason === null) cancelledAttempts.add(command.attempt);
        const recorder = attempts.get(command.attempt)?.recorder;
        if (recorder && recorder.state !== "inactive") recorder.stop();
        return;
      }

      case "ReleaseMedia":
        release(command.attempt);
        return;

      case "ScheduleDurationLimit": {
        const resources = attempts.get(command.attempt);
        if (!resources) return;
        durationLeases.replace(
          command.attempt,
          command.attempt,
          MAX_AUDIO_RECORDING_DURATION_MS,
          (attempt) => ({ type: "DURATION_ELAPSED", attempt }),
        );
        return;
      }

      case "CancelDurationLimit":
        cancelDuration(command.attempt);
        return;

      case "Transcribe": {
        const resources = attempts.get(command.attempt);
        const blob = new Blob(resources?.chunks ?? [], { type: "audio/webm" });
        if (resources) {
          resources.chunks = [];
          resources.recordedBytes = 0;
        }
        void blob
          .arrayBuffer()
          .then(
            (buffer) => {
              const audioData = new Uint8Array(buffer);
              if (audioData.byteLength > MAX_AUDIO_RECORDING_BYTES) {
                throw new Error("Recording exceeded the maximum audio size");
              }
              if (cancelledAttempts.delete(command.attempt)) return null;
              return ipc.audio.transcribeAudio({
                audioData,
                filename: "recording.webm",
                requestId: options.idSource.next("voice-transcription"),
              });
            },
            (error) => Promise.reject(error),
          )
          .then(
            (result) => {
              if (result === null) return;
              emit({
                type: "TRANSCRIPTION_OK",
                attempt: command.attempt,
                text: result.text,
              });
            },
            (error) =>
              emit({
                type: "TRANSCRIPTION_FAILED",
                attempt: command.attempt,
                message:
                  error instanceof Error
                    ? error.message
                    : "Transcription failed",
              }),
          );
        return;
      }

      case "DeliverTranscription":
        callbacks.onTranscription(command.text);
        return;

      case "NotifyError":
        callbacks.onError?.(command.message);
        return;

      default:
        return assertNever(command);
    }
  }

  return {
    run,
    beforeStateCommit(previous, next) {
      if (
        previous.type === "recording" &&
        (next.type !== "recording" || next.attempt !== previous.attempt)
      ) {
        cancelDuration(previous.attempt);
      }
    },
    dispose() {
      durationLeases.dispose();
    },
    updateCallbacks(nextCallbacks) {
      callbacks = nextCallbacks;
    },
  };
}

function assertNever(value: never): never {
  throw new Error(`Unexpected voice command: ${JSON.stringify(value)}`);
}
