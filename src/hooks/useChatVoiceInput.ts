import { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { jarvisClient } from "@/ipc/types/jarvis";
import { audioClient } from "@/ipc/types/audio";
import { useSettings } from "@/hooks/useSettings";
import { isDyadProEnabled } from "@/lib/schemas";

/**
 * Push-to-talk voice input for chat composers.
 *
 * Records from the microphone, exposes a live amplitude signal for the
 * waveform, then transcribes through ElevenLabs (main process holds the key)
 * or, when no ElevenLabs key is configured, the existing Pro transcription
 * service. The transcript is handed back so the composer can send it.
 */

export interface UseChatVoiceInputOptions {
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
}

/** Number of bars in the waveform display. */
export const WAVEFORM_BARS = 20;

export function useChatVoiceInput({
  onTranscript,
  onError,
}: UseChatVoiceInputOptions) {
  const { settings } = useSettings();
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [levels, setLevels] = useState<number[]>(() =>
    Array.from({ length: WAVEFORM_BARS }, () => 0),
  );

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frameRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  const hasElevenLabsKey = !!settings?.jarvis?.elevenLabsApiKey?.value;
  const canUseProTranscription = settings ? isDyadProEnabled(settings) : false;
  const isAvailable = hasElevenLabsKey || canUseProTranscription;

  const cleanup = useCallback(() => {
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    analyserRef.current = null;
    void contextRef.current?.close().catch(() => {});
    contextRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setLevels(Array.from({ length: WAVEFORM_BARS }, () => 0));
  }, []);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      cleanup();
    };
  }, [cleanup]);

  const trackLevels = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

    const tick = () => {
      const current = analyserRef.current;
      if (!current) return;
      current.getByteFrequencyData(data);

      // Collapse the spectrum into a fixed number of bars so the animation
      // reads as speech rather than raw FFT noise.
      const bucketSize = Math.floor(data.length / WAVEFORM_BARS) || 1;
      const next: number[] = [];
      for (let bar = 0; bar < WAVEFORM_BARS; bar++) {
        let sum = 0;
        for (let i = 0; i < bucketSize; i++) {
          sum += data[bar * bucketSize + i] ?? 0;
        }
        next.push(Math.min(1, sum / bucketSize / 180));
      }
      setLevels(next);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, []);

  const transcribe = useCallback(
    async (blob: Blob, mimeType: string) => {
      const buffer = await blob.arrayBuffer();
      if (hasElevenLabsKey) {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        const { text } = await jarvisClient.transcribe({
          audio: btoa(binary),
          mimeType,
        });
        return text;
      }
      const { text } = await audioClient.transcribeAudio({
        audioData: Array.from(new Uint8Array(buffer)),
        filename: "audio.webm",
        requestId: uuidv4(),
      });
      return text;
    },
    [hasElevenLabsKey],
  );

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.stop();
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!isAvailable) {
      onError?.(
        "Add an ElevenLabs API key in Settings → Voice Assistant to use voice input.",
      );
      return;
    }
    cancelledRef.current = false;

    try {
      const { microphoneAccess } = await jarvisClient.requestMicrophoneAccess();
      if (microphoneAccess === "denied") {
        onError?.(
          "Microphone access is denied. Enable it for Meta Human OS in System Settings → Privacy & Security → Microphone.",
        );
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const context = new AudioContext();
      contextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      context.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
      trackLevels();

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const chunks = chunksRef.current;
        chunksRef.current = [];
        setIsRecording(false);
        cleanup();

        if (cancelledRef.current || chunks.length === 0) return;
        const blob = new Blob(chunks, { type: mimeType });
        // Ignore taps too short to contain speech.
        if (blob.size < 1200) return;

        setIsTranscribing(true);
        void transcribe(blob, mimeType)
          .then((text) => {
            const trimmed = text.trim();
            if (trimmed) {
              onTranscript(trimmed);
            } else {
              onError?.("No speech was detected.");
            }
          })
          .catch((error: unknown) => {
            onError?.(
              error instanceof Error
                ? error.message
                : "Could not transcribe the recording.",
            );
          })
          .finally(() => setIsTranscribing(false));
      };

      recorder.start();
      setIsRecording(true);
    } catch (error) {
      cleanup();
      setIsRecording(false);
      onError?.(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone access was denied."
          : "No microphone is available.",
      );
    }
  }, [cleanup, isAvailable, onError, onTranscript, trackLevels, transcribe]);

  const toggleRecording = useCallback(() => {
    if (isTranscribing) return;
    if (isRecording) {
      stopRecording();
    } else {
      void startRecording();
    }
  }, [isRecording, isTranscribing, startRecording, stopRecording]);

  /** Discard the recording without transcribing. */
  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    stopRecording();
  }, [stopRecording]);

  return {
    isRecording,
    isTranscribing,
    isAvailable,
    levels,
    toggleRecording,
    cancelRecording,
  };
}
