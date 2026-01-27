/**
 * Voice Input Hook
 * React hook for voice assistant functionality
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import VoiceAssistantClient, {
  type VoiceConfig,
  type VoiceState,
  type TranscriptionResult,
  type TTSRequest,
  type TTSResult,
  type VoiceEvent,
  type VoiceCommand,
} from "@/ipc/voice_assistant_client";

// =============================================================================
// TYPES
// =============================================================================

export interface UseVoiceInputOptions {
  autoInitialize?: boolean;
  onTranscription?: (result: TranscriptionResult) => void;
  onCommand?: (command: VoiceCommand) => void;
  onStateChange?: (state: VoiceState) => void;
  onError?: (error: Error) => void;
}

export interface UseVoiceInputReturn {
  // State
  state: VoiceState;
  isListening: boolean;
  isProcessing: boolean;
  isSpeaking: boolean;
  isReady: boolean;
  
  // Config
  config: VoiceConfig | null;
  updateConfig: (updates: Partial<VoiceConfig>) => Promise<void>;
  
  // Transcription
  currentTranscription: TranscriptionResult | null;
  transcriptionHistory: TranscriptionResult[];
  
  // Actions
  startListening: () => Promise<void>;
  stopListening: () => Promise<TranscriptionResult | null>;
  toggleListening: () => Promise<void>;
  speak: (text: string, options?: Partial<TTSRequest>) => Promise<TTSResult>;
  
  // Model management
  downloadModel: (model: VoiceConfig["whisperModel"]) => Promise<void>;
  installedModels: { whisper: string[]; tts: string[] } | null;
  
  // Utilities
  initialize: () => Promise<void>;
  shutdown: () => Promise<void>;
}

// =============================================================================
// HOOK
// =============================================================================

export function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  const {
    autoInitialize = false,
    onTranscription,
    onCommand,
    onStateChange,
    onError,
  } = options;
  
  const queryClient = useQueryClient();
  const [state, setState] = useState<VoiceState>("idle");
  const [currentTranscription, setCurrentTranscription] = useState<TranscriptionResult | null>(null);
  const [transcriptionHistory, setTranscriptionHistory] = useState<TranscriptionResult[]>([]);
  const [isReady, setIsReady] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  
  // ---------------------------------------------------------------------------
  // CONFIG QUERY
  // ---------------------------------------------------------------------------
  
  const { data: config } = useQuery({
    queryKey: ["voice-config"],
    queryFn: () => VoiceAssistantClient.getConfig(),
    enabled: isReady,
  });
  
  // ---------------------------------------------------------------------------
  // INSTALLED MODELS QUERY
  // ---------------------------------------------------------------------------
  
  const { data: installedModels } = useQuery({
    queryKey: ["voice-installed-models"],
    queryFn: () => VoiceAssistantClient.getInstalledModels(),
    enabled: isReady,
  });
  
  // ---------------------------------------------------------------------------
  // MUTATIONS
  // ---------------------------------------------------------------------------
  
  const initializeMutation = useMutation({
    mutationFn: async () => {
      await VoiceAssistantClient.initialize();
      await VoiceAssistantClient.subscribe();
    },
    onSuccess: () => {
      setIsReady(true);
      queryClient.invalidateQueries({ queryKey: ["voice-config"] });
    },
    onError: (error) => {
      onError?.(error as Error);
      toast.error("Failed to initialize voice assistant");
    },
  });
  
  const shutdownMutation = useMutation({
    mutationFn: () => VoiceAssistantClient.shutdown(),
    onSuccess: () => {
      setIsReady(false);
      setState("idle");
    },
  });
  
  const updateConfigMutation = useMutation({
    mutationFn: (updates: Partial<VoiceConfig>) => VoiceAssistantClient.updateConfig(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["voice-config"] });
      toast.success("Voice settings updated");
    },
    onError: () => {
      toast.error("Failed to update voice settings");
    },
  });
  
  const startListeningMutation = useMutation({
    mutationFn: () => VoiceAssistantClient.startListening(),
    onSuccess: () => {
      setState("listening");
    },
    onError: (error) => {
      onError?.(error as Error);
      toast.error("Failed to start listening");
    },
  });
  
  const stopListeningMutation = useMutation({
    mutationFn: () => VoiceAssistantClient.stopListening(),
    onSuccess: (result) => {
      if (result) {
        setCurrentTranscription(result);
        setTranscriptionHistory((prev) => [result, ...prev].slice(0, 50));
        onTranscription?.(result);
      }
    },
    onError: (error) => {
      onError?.(error as Error);
      toast.error("Failed to process audio");
    },
  });
  
  const speakMutation = useMutation({
    mutationFn: (request: TTSRequest) => VoiceAssistantClient.speak(request),
    onError: () => {
      toast.error("Failed to speak");
    },
  });
  
  const downloadModelMutation = useMutation({
    mutationFn: (model: VoiceConfig["whisperModel"]) => VoiceAssistantClient.downloadWhisperModel(model),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["voice-installed-models"] });
      toast.success("Model downloaded successfully");
    },
    onError: () => {
      toast.error("Failed to download model");
    },
  });
  
  // ---------------------------------------------------------------------------
  // EVENT HANDLING
  // ---------------------------------------------------------------------------
  
  useEffect(() => {
    if (!isReady) return;
    
    const handleEvent = (event: VoiceEvent) => {
      switch (event.type) {
        case "state:changed":
          setState(event.data.current);
          onStateChange?.(event.data.current);
          break;
        
        case "transcription":
          setCurrentTranscription(event.data);
          setTranscriptionHistory((prev) => [event.data, ...prev].slice(0, 50));
          onTranscription?.(event.data);
          break;
        
        case "command":
          onCommand?.(event.data);
          break;
        
        case "error":
          onError?.(new Error(event.data.error || "Voice error"));
          break;
      }
    };
    
    unsubscribeRef.current = VoiceAssistantClient.onEvent(handleEvent);
    
    return () => {
      unsubscribeRef.current?.();
    };
  }, [isReady, onTranscription, onCommand, onStateChange, onError]);
  
  // ---------------------------------------------------------------------------
  // AUTO-INITIALIZE
  // ---------------------------------------------------------------------------
  
  useEffect(() => {
    if (autoInitialize && !isReady) {
      initializeMutation.mutate();
    }
    
    return () => {
      unsubscribeRef.current?.();
    };
  }, [autoInitialize]);
  
  // ---------------------------------------------------------------------------
  // ACTIONS
  // ---------------------------------------------------------------------------
  
  const initialize = useCallback(async () => {
    await initializeMutation.mutateAsync();
  }, []);
  
  const shutdown = useCallback(async () => {
    await shutdownMutation.mutateAsync();
  }, []);
  
  const updateConfig = useCallback(async (updates: Partial<VoiceConfig>) => {
    await updateConfigMutation.mutateAsync(updates);
  }, []);
  
  const startListening = useCallback(async () => {
    if (!isReady) {
      await initialize();
    }
    await startListeningMutation.mutateAsync();
  }, [isReady, initialize]);
  
  const stopListening = useCallback(async () => {
    return stopListeningMutation.mutateAsync();
  }, []);
  
  const toggleListening = useCallback(async () => {
    if (state === "listening") {
      await stopListening();
    } else {
      await startListening();
    }
  }, [state, startListening, stopListening]);
  
  const speak = useCallback(async (text: string, opts?: Partial<TTSRequest>) => {
    return speakMutation.mutateAsync({ text, ...opts });
  }, []);
  
  const downloadModel = useCallback(async (model: VoiceConfig["whisperModel"]) => {
    await downloadModelMutation.mutateAsync(model);
  }, []);
  
  // ---------------------------------------------------------------------------
  // RETURN
  // ---------------------------------------------------------------------------
  
  return {
    // State
    state,
    isListening: state === "listening",
    isProcessing: state === "processing",
    isSpeaking: state === "speaking",
    isReady,
    
    // Config
    config: config ?? null,
    updateConfig,
    
    // Transcription
    currentTranscription,
    transcriptionHistory,
    
    // Actions
    startListening,
    stopListening,
    toggleListening,
    speak,
    
    // Model management
    downloadModel,
    installedModels: installedModels ?? null,
    
    // Utilities
    initialize,
    shutdown,
  };
}

export default useVoiceInput;
