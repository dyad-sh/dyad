/**
 * Voice Assistant IPC Client
 * Renderer-side API for voice assistant functionality
 */

import type { IpcRenderer } from "electron";

// =============================================================================
// TYPES (mirrored from voice_assistant.ts)
// =============================================================================

export type VoiceMode = "push-to-talk" | "continuous" | "wake-word";
export type VoiceState = "idle" | "listening" | "processing" | "speaking" | "error";

export interface VoiceConfig {
  mode: VoiceMode;
  wakeWord: string;
  language: string;
  whisperModel: "tiny" | "base" | "small" | "medium" | "large";
  ttsModel: "bark" | "coqui" | "piper";
  ttsVoice: string;
  silenceThreshold: number;
  silenceDuration: number;
  autoSubmit: boolean;
  soundEffects: boolean;
  continuousMode: boolean;
}

export interface TranscriptionResult {
  id: string;
  text: string;
  confidence: number;
  language: string;
  duration: number;
  segments: TranscriptionSegment[];
  isFinal: boolean;
  timestamp: number;
}

export interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  confidence: number;
}

export interface TTSRequest {
  text: string;
  voice?: string;
  speed?: number;
  pitch?: number;
  emotion?: "neutral" | "happy" | "sad" | "excited" | "calm";
}

export interface TTSResult {
  id: string;
  audioPath: string;
  duration: number;
  text: string;
}

export interface VoiceCommand {
  type: "build" | "edit" | "run" | "stop" | "undo" | "help" | "navigate" | "custom";
  intent: string;
  entities: Record<string, string>;
  confidence: number;
  rawText: string;
}

export type VoiceEventType = 
  | "state:changed"
  | "transcription"
  | "command"
  | "tts:start"
  | "tts:ready"
  | "tts:complete"
  | "error"
  | "sound:start"
  | "sound:stop";

export interface VoiceEvent {
  type: VoiceEventType;
  data?: any;
}

// =============================================================================
// CLIENT
// =============================================================================

let ipcRenderer: IpcRenderer | null = null;

function getIpcRenderer(): IpcRenderer {
  if (!ipcRenderer) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ipcRenderer = (window as any).electron?.ipcRenderer;
    if (!ipcRenderer) {
      throw new Error("IPC Renderer not available");
    }
  }
  return ipcRenderer;
}

export const VoiceAssistantClient = {
  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  /**
   * Initialize the voice assistant
   */
  async initialize(config?: Partial<VoiceConfig>): Promise<{ success: boolean; config: VoiceConfig }> {
    return getIpcRenderer().invoke("voice:initialize", config);
  },

  /**
   * Shut down the voice assistant
   */
  async shutdown(): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("voice:shutdown");
  },

  // ---------------------------------------------------------------------------
  // CONFIGURATION
  // ---------------------------------------------------------------------------

  /**
   * Get current configuration
   */
  async getConfig(): Promise<VoiceConfig> {
    return getIpcRenderer().invoke("voice:get-config");
  },

  /**
   * Update configuration
   */
  async updateConfig(updates: Partial<VoiceConfig>): Promise<VoiceConfig> {
    return getIpcRenderer().invoke("voice:update-config", updates);
  },

  /**
   * Get current state
   */
  async getState(): Promise<VoiceState> {
    return getIpcRenderer().invoke("voice:get-state");
  },

  // ---------------------------------------------------------------------------
  // LISTENING & TRANSCRIPTION
  // ---------------------------------------------------------------------------

  /**
   * Start listening for voice input
   */
  async startListening(): Promise<string> {
    return getIpcRenderer().invoke("voice:start-listening");
  },

  /**
   * Stop listening and get transcription
   */
  async stopListening(): Promise<TranscriptionResult | null> {
    return getIpcRenderer().invoke("voice:stop-listening");
  },

  /**
   * Transcribe an audio file
   */
  async transcribeFile(audioPath: string): Promise<TranscriptionResult> {
    return getIpcRenderer().invoke("voice:transcribe-file", audioPath);
  },

  // ---------------------------------------------------------------------------
  // TEXT-TO-SPEECH
  // ---------------------------------------------------------------------------

  /**
   * Speak text using TTS
   */
  async speak(request: TTSRequest): Promise<TTSResult> {
    return getIpcRenderer().invoke("voice:speak", request);
  },

  // ---------------------------------------------------------------------------
  // MODEL MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Download a Whisper model
   */
  async downloadWhisperModel(model: VoiceConfig["whisperModel"]): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("voice:download-whisper-model", model);
  },

  /**
   * Get installed models
   */
  async getInstalledModels(): Promise<{ whisper: string[]; tts: string[] }> {
    return getIpcRenderer().invoke("voice:get-installed-models");
  },

  // ---------------------------------------------------------------------------
  // EVENTS
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to voice assistant events
   */
  async subscribe(): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("voice:subscribe");
  },

  /**
   * Listen for voice events
   */
  onEvent(callback: (event: VoiceEvent) => void): () => void {
    const handler = (_: unknown, event: VoiceEvent) => callback(event);
    getIpcRenderer().on("voice:event" as any, handler);
    return () => {
      getIpcRenderer().removeListener("voice:event" as any, handler);
    };
  },
};

export default VoiceAssistantClient;
