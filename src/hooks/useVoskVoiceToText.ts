/// <reference types="vite/client" />
import { useCallback, useEffect, useRef, useState } from "react";

const SAMPLE_RATE = 16000;
const DEFAULT_MODEL_URL =
  import.meta.env.VITE_VOSK_MODEL_URL ??
  "/models/vosk-model-small-en-us-0.15.tar.gz";

type VoskModel = {
  KaldiRecognizer: new (sampleRate?: number) => VoskRecognizer;
  ready?: boolean;
  on?: (event: string, handler: (message: any) => void) => void;
  terminate?: () => void;
  setLogLevel?: (level: number) => void;
};

type VoskRecognizer = {
  acceptWaveform: (buffer: AudioBuffer) => void;
  setWords?: (words: boolean) => void;
  remove?: () => void;
  on?: (event: string, handler: (message: any) => void) => void;
};

type UseVoskVoiceToTextOptions = {
  onFinalResult?: (text: string) => void;
  onPartialResult?: (text: string) => void;
  modelUrl?: string;
};

export function useVoskVoiceToText({
  onFinalResult,
  onPartialResult,
  modelUrl = DEFAULT_MODEL_URL,
}: UseVoskVoiceToTextOptions) {
  const [isInitializing, setIsInitializing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partialText, setPartialText] = useState("");
  const latestPartialRef = useRef("");
  const testEventHandlerRef = useRef<((event: Event) => void) | null>(null);

  const modelRef = useRef<VoskModel | null>(null);
  const recognizerRef = useRef<VoskRecognizer | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isTestMode =
    typeof window !== "undefined" &&
    Boolean((window as any).__DYAD_TEST_VOICE__ === true);

  const resetError = useCallback(() => setError(null), []);

  const cleanupAudio = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;

    audioContextRef.current?.close().catch(() => {
      /* noop */
    });
    audioContextRef.current = null;

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  const cleanupRecognizer = useCallback(() => {
    recognizerRef.current?.remove?.();
    recognizerRef.current = null;
  }, []);

  const cleanupAll = useCallback(() => {
    cleanupAudio();
    cleanupRecognizer();
    setIsRecording(false);
    setPartialText("");
    latestPartialRef.current = "";
  }, [cleanupAudio, cleanupRecognizer]);

  const ensureModel = useCallback(async () => {
    if (modelRef.current) return modelRef.current;

    setIsInitializing(true);
    setError(null);
    try {
      const vosk = (await import("vosk-browser")) as any;
      const model: VoskModel =
        (vosk.createModel && (await vosk.createModel(modelUrl))) ||
        new vosk.Model(modelUrl);

      // Wait for model to finish loading if it exposes events
      if (!model.ready && model.on) {
        await new Promise<void>((resolve, reject) => {
          const handleLoad = (message: any) => {
            if (message?.result === false) {
              reject(
                new Error("Failed to load Vosk model. Check the modelUrl."),
              );
              return;
            }
            resolve();
          };
          const handleError = (message: any) => {
            reject(
              new Error(
                message?.error ||
                  "Unable to load Vosk model. See console for details.",
              ),
            );
          };

          model.on?.("load", handleLoad);
          model.on?.("error", handleError);
        });
      }

      model.setLogLevel?.(-1);
      modelRef.current = model;
      return model;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to initialize Vosk.";
      setError(message);
      throw err;
    } finally {
      setIsInitializing(false);
    }
  }, [modelUrl]);

  const stopRecording = useCallback(() => {
    if (testEventHandlerRef.current) {
      window.removeEventListener("dyad-test-voice", testEventHandlerRef.current);
      testEventHandlerRef.current = null;
    }
    if (latestPartialRef.current) {
      onFinalResult?.(latestPartialRef.current);
      latestPartialRef.current = "";
    }
    cleanupAll();
  }, [cleanupAll, onFinalResult]);

  const startRecording = useCallback(async () => {
    if (isRecording) return;

    try {
      if (isTestMode) {
        setIsRecording(true);
        const handler = (event: Event) => {
          const detail = (event as CustomEvent).detail || {};
          const text: string = detail.text ?? "";
          const isFinal = Boolean(detail.final);
          if (text) {
            if (isFinal) {
              latestPartialRef.current = "";
              onFinalResult?.(text);
            } else {
              latestPartialRef.current = text;
              setPartialText(text);
              onPartialResult?.(text);
            }
          }
        };
        window.addEventListener("dyad-test-voice", handler as EventListener);
        testEventHandlerRef.current = handler as EventListener;
        return;
      }

      const model = await ensureModel();
      const recognizer = new model.KaldiRecognizer(SAMPLE_RATE);
      recognizerRef.current = recognizer;

      recognizer.setWords?.(true);
      recognizer.on?.("result", (message: any) => {
        const text = message?.result?.text?.trim();
        if (text) {
          setPartialText("");
          latestPartialRef.current = "";
          onFinalResult?.(text);
        }
      });
      recognizer.on?.("partialresult", (message: any) => {
        const text = message?.result?.partial ?? "";
        setPartialText(text);
        latestPartialRef.current = text;
        onPartialResult?.(text);
      });

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
        },
      });
      streamRef.current = mediaStream;

      const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = audioContext;

      const recognizerNode = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = recognizerNode;
      recognizerNode.onaudioprocess = (event) => {
        try {
          recognizer.acceptWaveform(event.inputBuffer);
        } catch (err) {
          console.error("acceptWaveform failed", err);
          setError(
            err instanceof Error
              ? err.message
              : "Unable to process microphone audio.",
          );
          stopRecording();
        }
      };

      const source = audioContext.createMediaStreamSource(mediaStream);
      source.connect(recognizerNode);
      recognizerNode.connect(audioContext.destination);

      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start voice capture", err);
      const message =
        err instanceof Error
          ? err.message
          : "Unable to access microphone or model.";
      setError(message);
      cleanupAll();
    }
  }, [
    cleanupAll,
    ensureModel,
    isRecording,
    onFinalResult,
    onPartialResult,
    stopRecording,
  ]);

  useEffect(() => {
    return () => {
      if (testEventHandlerRef.current) {
        window.removeEventListener(
          "dyad-test-voice",
          testEventHandlerRef.current,
        );
      }
      cleanupAll();
      modelRef.current?.terminate?.();
      modelRef.current = null;
    };
  }, [cleanupAll]);

  return {
    startRecording,
    stopRecording,
    isRecording,
    isInitializing,
    partialText,
    error,
    resetError,
  };
}
