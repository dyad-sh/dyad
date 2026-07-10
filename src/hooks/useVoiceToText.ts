import { useState, useRef, useCallback, useEffect } from "react";
import { ipc } from "@/ipc/types";
import {
  AUDIO_RECORDING_TIMESLICE_MS,
  MAX_AUDIO_RECORDING_BYTES,
  MAX_AUDIO_RECORDING_DURATION_MS,
} from "@/ipc/types/audio";
import { v4 as uuidv4 } from "uuid";

interface UseVoiceToTextOptions {
  enabled: boolean;
  onTranscription: (text: string) => void;
  onError?: (error: string) => void;
}

type RecordingStopReason = "duration" | "size" | null;

const RECORDING_LIMIT_MESSAGES: Record<
  Exclude<RecordingStopReason, null>,
  string
> = {
  duration:
    "Recording reached the maximum duration and was stopped. Any captured audio will still be transcribed.",
  size: "Recording reached the maximum size and was stopped. Any captured audio will still be transcribed.",
};

export function useVoiceToText({
  enabled,
  onTranscription,
  onError,
}: UseVoiceToTextOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordedBytesRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopReasonRef = useRef<RecordingStopReason>(null);
  const skipOnStopProcessingRef = useRef(false);
  const isMountedRef = useRef(true);
  const isStartingRef = useRef(false);
  const startAttemptRef = useRef(0);

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const stopMediaStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const stopActiveRecording = useCallback(
    (reason: RecordingStopReason) => {
      const mediaRecorder = mediaRecorderRef.current;
      if (mediaRecorder?.state === "recording") {
        stopReasonRef.current = reason;
        clearRecordingTimer();
        mediaRecorder.stop();
      }
    },
    [clearRecordingTimer],
  );

  useEffect(() => {
    isMountedRef.current = true;
    skipOnStopProcessingRef.current = false;

    return () => {
      isMountedRef.current = false;
      isStartingRef.current = false;
      startAttemptRef.current += 1;
      skipOnStopProcessingRef.current = true;
      clearRecordingTimer();

      const mediaRecorder = mediaRecorderRef.current;
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
      mediaRecorderRef.current = null;
      stopMediaStream();
      chunksRef.current = [];
      recordedBytesRef.current = 0;
    };
  }, [clearRecordingTimer, stopMediaStream]);

  const toggleRecording = useCallback(async () => {
    if (isTranscribing || isStartingRef.current) return;

    if (isRecording || mediaRecorderRef.current?.state === "recording") {
      stopActiveRecording(null);
      return;
    }

    if (!enabled) return;

    const startAttempt = startAttemptRef.current + 1;
    startAttemptRef.current = startAttempt;
    isStartingRef.current = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isMountedRef.current || startAttempt !== startAttemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm",
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      recordedBytesRef.current = 0;
      stopReasonRef.current = null;
      skipOnStopProcessingRef.current = false;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;

        const nextRecordedBytes = recordedBytesRef.current + event.data.size;
        if (nextRecordedBytes > MAX_AUDIO_RECORDING_BYTES) {
          stopActiveRecording("size");
          return;
        }

        chunksRef.current.push(event.data);
        recordedBytesRef.current = nextRecordedBytes;
        if (nextRecordedBytes >= MAX_AUDIO_RECORDING_BYTES) {
          stopActiveRecording("size");
        }
      };

      mediaRecorder.onstop = async () => {
        clearRecordingTimer();
        mediaRecorderRef.current = null;
        stopMediaStream();

        const stopReason = stopReasonRef.current;
        stopReasonRef.current = null;
        const chunks = chunksRef.current;
        chunksRef.current = [];
        recordedBytesRef.current = 0;

        if (skipOnStopProcessingRef.current || !isMountedRef.current) {
          return;
        }

        setIsRecording(false);
        if (stopReason) {
          onError?.(RECORDING_LIMIT_MESSAGES[stopReason]);
        }

        const blob = new Blob(chunks, { type: "audio/webm" });
        if (blob.size === 0) {
          return;
        }

        setIsTranscribing(true);
        try {
          const audioData = new Uint8Array(await blob.arrayBuffer());
          if (audioData.byteLength > MAX_AUDIO_RECORDING_BYTES) {
            throw new Error("Recording exceeded the maximum audio size");
          }

          if (!isMountedRef.current) {
            return;
          }

          const result = await ipc.audio.transcribeAudio({
            audioData,
            filename: "recording.webm",
            requestId: uuidv4(),
          });

          if (isMountedRef.current && result.text.trim()) {
            onTranscription(result.text.trim());
          }
        } catch (err) {
          if (isMountedRef.current) {
            const message =
              err instanceof Error ? err.message : "Transcription failed";
            onError?.(message);
          }
        } finally {
          if (isMountedRef.current) {
            setIsTranscribing(false);
          }
        }
      };

      mediaRecorder.start(AUDIO_RECORDING_TIMESLICE_MS);
      recordingTimerRef.current = setTimeout(() => {
        stopActiveRecording("duration");
      }, MAX_AUDIO_RECORDING_DURATION_MS);
      setIsRecording(true);
    } catch (err) {
      stopMediaStream();
      if (isMountedRef.current) {
        const message =
          err instanceof Error ? err.message : "Failed to access microphone";
        onError?.(message);
      }
    } finally {
      if (startAttempt === startAttemptRef.current) {
        isStartingRef.current = false;
      }
    }
  }, [
    enabled,
    isRecording,
    isTranscribing,
    onTranscription,
    onError,
    stopActiveRecording,
    stopMediaStream,
    clearRecordingTimer,
  ]);

  return {
    isRecording,
    isTranscribing,
    toggleRecording,
  };
}
