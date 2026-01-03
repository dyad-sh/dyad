import { useCallback, useEffect, useRef, useState } from "react";

const SAMPLE_RATE = 16000;
const DEFAULT_MODEL_URL = "/models/vosk-model-small-en-us-0.15.tar.gz";

interface VoskModelMessage {
  result?: boolean;
  error?: string;
}

interface VoskRecognizerResultMessage {
  result: {
    text?: string;
    partial?: string;
  };
}

type VoskModelEvent = "load" | "error";
type VoskRecognizerEvent = "result" | "partialresult";

type VoskModelEventHandler = (message: VoskModelMessage) => void;
type VoskRecognizerEventHandler = (
  message: VoskRecognizerResultMessage,
) => void;

interface VoskModel {
  KaldiRecognizer: new (sampleRate?: number) => VoskRecognizer;
  ready?: boolean;
  on?: (event: VoskModelEvent, handler: VoskModelEventHandler) => void;
  terminate?: () => void;
  setLogLevel?: (level: number) => void;
}

interface VoskRecognizer {
  acceptWaveform: (buffer: AudioBuffer) => void;
  setWords?: (words: boolean) => void;
  remove?: () => void;
  on?: (
    event: VoskRecognizerEvent,
    handler: VoskRecognizerEventHandler,
  ) => void;
}

interface VoskModule {
  Model: new (modelUrl: string) => VoskModel;
  createModel?: (modelUrl: string) => Promise<VoskModel>;
}

interface UseVoskVoiceToTextOptions {
  onFinalResult?: (text: string) => void;
  onPartialResult?: (text: string) => void;
  modelUrl?: string;
}

interface TestVoiceEventDetail {
  text?: string;
  final?: boolean;
}

/**
 * Custom React hook for voice-to-text functionality using Vosk.
 *
 * @param options - Configuration options for the hook
 * @param options.onFinalResult - Callback invoked when final transcription is available
 * @param options.onPartialResult - Callback invoked when partial transcription is available
 * @param options.modelUrl - URL to the Vosk model file (defaults to env var or default model)
 * @returns Object containing recording state and control functions
 */
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
  const modelLoadHandlersRef = useRef<{
    load?: VoskModelEventHandler;
    error?: VoskModelEventHandler;
  }>({});
  const isMountedRef = useRef(true);

  const isTestMode =
    typeof window !== "undefined" &&
    Boolean(
      (window as { __DYAD_TEST_VOICE__?: boolean }).__DYAD_TEST_VOICE__ ===
        true,
    );

  const resetError = useCallback(() => {
    setError(null);
  }, []);

  const cleanupAudio = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;

    audioContextRef.current?.close().catch(() => {
      // Ignore errors when closing audio context
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

  const cleanupTestEventHandler = useCallback(() => {
    if (testEventHandlerRef.current) {
      window.removeEventListener(
        "dyad-test-voice",
        testEventHandlerRef.current,
      );
      testEventHandlerRef.current = null;
    }
  }, []);

  const cleanupAll = useCallback(() => {
    cleanupAudio();
    cleanupRecognizer();
    cleanupTestEventHandler();
    setIsRecording(false);
    setPartialText("");
    latestPartialRef.current = "";
  }, [cleanupAudio, cleanupRecognizer, cleanupTestEventHandler]);

  const ensureModel = useCallback(async (): Promise<VoskModel> => {
    if (modelRef.current) {
      return modelRef.current;
    }

    setIsInitializing(true);
    setError(null);

    try {
      const vosk = (await import("vosk-browser")) as VoskModule;
      const model: VoskModel =
        (vosk.createModel && (await vosk.createModel(modelUrl))) ||
        new vosk.Model(modelUrl);

      // Wait for model to finish loading if it exposes events
      if (!model.ready && model.on) {
        await new Promise<void>((resolve, reject) => {
          const handleLoad: VoskModelEventHandler = (message) => {
            cleanupModelHandlers(model);
            if (message?.result === false) {
              reject(
                new Error("Failed to load Vosk model. Check the modelUrl."),
              );
              return;
            }
            resolve();
          };

          const handleError: VoskModelEventHandler = (message) => {
            cleanupModelHandlers(model);
            reject(
              new Error(
                message?.error ||
                  "Unable to load Vosk model. See console for details.",
              ),
            );
          };

          if (model.on) {
            model.on("load", handleLoad);
            model.on("error", handleError);
            modelLoadHandlersRef.current = {
              load: handleLoad,
              error: handleError,
            };
          }
        });
      }

      model.setLogLevel?.(-1);
      modelRef.current = model;
      return model;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to initialize Vosk.";
      if (isMountedRef.current) {
        setError(message);
      }
      throw err;
    } finally {
      if (isMountedRef.current) {
        setIsInitializing(false);
      }
    }
  }, [modelUrl]);

  const cleanupModelHandlers = useCallback((model: VoskModel) => {
    const handlers = modelLoadHandlersRef.current;
    if (model.on && handlers.load) {
      // Note: vosk-browser may not support removing handlers, but we clean up refs
      modelLoadHandlersRef.current = {};
    }
  }, []);

  const handleFinalResult = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      setPartialText("");
      latestPartialRef.current = "";
      onFinalResult?.(text);
    },
    [onFinalResult],
  );

  const handlePartialResult = useCallback(
    (text: string) => {
      setPartialText(text);
      latestPartialRef.current = text;
      onPartialResult?.(text);
    },
    [onPartialResult],
  );

  const stopRecording = useCallback(() => {
    cleanupTestEventHandler();
    if (latestPartialRef.current) {
      handleFinalResult(latestPartialRef.current);
    }
    cleanupAll();
  }, [cleanupAll, cleanupTestEventHandler, handleFinalResult]);

  const startRecording = useCallback(async () => {
    if (isRecording) return;

    try {
      if (isTestMode) {
        setIsRecording(true);
        const handler = (event: Event) => {
          const detail =
            (event as CustomEvent<TestVoiceEventDetail>).detail || {};
          const text = detail.text ?? "";
          const isFinal = Boolean(detail.final);
          if (text) {
            if (isFinal) {
              handleFinalResult(text);
            } else {
              handlePartialResult(text);
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
      recognizer.on?.("result", (message) => {
        const text = message?.result?.text?.trim();
        if (text) {
          handleFinalResult(text);
        }
      });
      recognizer.on?.("partialresult", (message) => {
        const text = message?.result?.partial ?? "";
        handlePartialResult(text);
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
          if (isMountedRef.current) {
            setError(
              err instanceof Error
                ? err.message
                : "Unable to process microphone audio.",
            );
          }
          stopRecording();
        }
      };

      const source = audioContext.createMediaStreamSource(mediaStream);
      source.connect(recognizerNode);
      recognizerNode.connect(audioContext.destination);

      setIsRecording(true);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unable to access microphone or model.";
      if (isMountedRef.current) {
        setError(message);
      }
      cleanupAll();
    }
  }, [
    cleanupAll,
    ensureModel,
    handleFinalResult,
    handlePartialResult,
    isRecording,
    isTestMode,
    stopRecording,
  ]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cleanupAll();
      if (modelRef.current) {
        cleanupModelHandlers(modelRef.current);
        modelRef.current.terminate?.();
        modelRef.current = null;
      }
    };
  }, [cleanupAll, cleanupModelHandlers]);

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
