import { useState, useRef, useCallback } from "react";
import { ipc } from "@/ipc/types";
import { v4 as uuidv4 } from "uuid";

interface UseVoiceToTextOptions {
  enabled: boolean;
  onTranscription: (text: string) => void;
  onError?: (error: string) => void;
}

export function useVoiceToText({
  enabled,
  onTranscription,
  onError,
}: UseVoiceToTextOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stopMediaStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const toggleRecording = useCallback(async () => {
    if (!enabled) return;

    if (isTranscribing) return;

    if (isRecording) {
      // Stop recording
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      return;
    }

    // Start recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm",
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsRecording(false);
        stopMediaStream();

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = [];

        if (blob.size === 0) {
          return;
        }

        setIsTranscribing(true);
        try {
          const arrayBuffer = await blob.arrayBuffer();
          const audioData = Array.from(new Uint8Array(arrayBuffer));

          const result = await ipc.audio.transcribeAudio({
            audioData,
            filename: "recording.webm",
            requestId: uuidv4(),
          });

          if (result.text.trim()) {
            onTranscription(result.text.trim());
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Transcription failed";
          onError?.(message);
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      stopMediaStream();
      const message =
        err instanceof Error ? err.message : "Failed to access microphone";
      onError?.(message);
    }
  }, [
    enabled,
    isRecording,
    isTranscribing,
    onTranscription,
    onError,
    stopMediaStream,
  ]);

  return {
    isRecording,
    isTranscribing,
    toggleRecording,
  };
}
