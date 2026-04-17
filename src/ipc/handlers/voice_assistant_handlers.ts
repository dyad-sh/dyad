/**
 * Voice Assistant IPC Handlers
 * Connect renderer to voice assistant functionality
 */

import { ipcMain } from "electron";
import log from "electron-log";
import {
  voiceAssistant,
  type VoiceConfig,
  type TTSRequest,
  type TranscriptionResult,
  type TTSResult,
  type SystemCapabilities,
  type ElevenLabsVoice,
} from "@/lib/voice_assistant";

const logger = log.scope("voice_handlers");

// =============================================================================
// IPC HANDLER REGISTRATION
// =============================================================================

export function registerVoiceAssistantHandlers(): void {
  logger.info("Registering Voice Assistant IPC handlers");

  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  ipcMain.handle("voice:initialize", async (_, config?: Partial<VoiceConfig>) => {
    await voiceAssistant.initialize(config);
    return { success: true, config: voiceAssistant.getConfig() };
  });

  ipcMain.handle("voice:shutdown", async () => {
    await voiceAssistant.shutdown();
    return { success: true };
  });

  // ---------------------------------------------------------------------------
  // CONFIGURATION
  // ---------------------------------------------------------------------------

  ipcMain.handle("voice:get-config", async () => {
    return voiceAssistant.getConfig();
  });

  ipcMain.handle("voice:update-config", async (_, updates: Partial<VoiceConfig>) => {
    return voiceAssistant.updateConfig(updates);
  });

  ipcMain.handle("voice:get-state", async () => {
    return voiceAssistant.getState();
  });

  // ---------------------------------------------------------------------------
  // LISTENING & TRANSCRIPTION
  // ---------------------------------------------------------------------------

  ipcMain.handle("voice:start-listening", async (): Promise<string> => {
    return voiceAssistant.startListening();
  });

  ipcMain.handle("voice:stop-listening", async (): Promise<TranscriptionResult | null> => {
    return voiceAssistant.stopListening();
  });

  ipcMain.handle("voice:transcribe-file", async (_, audioPath: string): Promise<TranscriptionResult> => {
    return voiceAssistant.transcribe(audioPath);
  });

  // ---------------------------------------------------------------------------
  // TEXT-TO-SPEECH
  // ---------------------------------------------------------------------------

  ipcMain.handle("voice:speak", async (_, request: TTSRequest): Promise<TTSResult> => {
    return voiceAssistant.speak(request);
  });

  // ---------------------------------------------------------------------------
  // MODEL MANAGEMENT
  // ---------------------------------------------------------------------------

  ipcMain.handle("voice:download-whisper-model", async (_, model: VoiceConfig["whisperModel"]) => {
    await voiceAssistant.downloadWhisperModel(model);
    return { success: true };
  });

  ipcMain.handle("voice:get-installed-models", async () => {
    return voiceAssistant.getInstalledModels();
  });

  // ---------------------------------------------------------------------------
  // SYSTEM CAPABILITIES
  // ---------------------------------------------------------------------------

  ipcMain.handle("voice:get-capabilities", async (): Promise<SystemCapabilities> => {
    const caps = voiceAssistant.getCapabilities();
    if (caps) return caps;
    return voiceAssistant.detectSystemCapabilities();
  });

  // ---------------------------------------------------------------------------
  // ELEVENLABS
  // ---------------------------------------------------------------------------

  ipcMain.handle("voice:get-elevenlabs-voices", async (): Promise<ElevenLabsVoice[]> => {
    return voiceAssistant.getElevenLabsVoices();
  });

  ipcMain.handle("voice:set-elevenlabs-key", async (_, apiKey: string) => {
    if (!apiKey || typeof apiKey !== "string") {
      throw new Error("Invalid API key");
    }
    voiceAssistant.setElevenLabsApiKey(apiKey.trim());
  });

  // ---------------------------------------------------------------------------
  // EVENT FORWARDING
  // ---------------------------------------------------------------------------

  // Forward voice assistant events to renderer
  const eventForwarder = (event: Electron.IpcMainInvokeEvent) => {
    const sender = event.sender;
    
    voiceAssistant.on("state:changed", (data) => {
      sender.send("voice:event", { type: "state:changed", data });
    });
    
    voiceAssistant.on("transcription", (data) => {
      sender.send("voice:event", { type: "transcription", data });
    });
    
    voiceAssistant.on("command", (data) => {
      sender.send("voice:event", { type: "command", data });
    });
    
    voiceAssistant.on("tts:start", (data) => {
      sender.send("voice:event", { type: "tts:start", data });
    });
    
    voiceAssistant.on("tts:ready", (data) => {
      sender.send("voice:event", { type: "tts:ready", data });
    });
    
    voiceAssistant.on("tts:complete", (data) => {
      sender.send("voice:event", { type: "tts:complete", data });
    });
    
    voiceAssistant.on("error", (data) => {
      sender.send("voice:event", { type: "error", data });
    });
    
    voiceAssistant.on("sound:start", () => {
      sender.send("voice:event", { type: "sound:start" });
    });
    
    voiceAssistant.on("sound:stop", () => {
      sender.send("voice:event", { type: "sound:stop" });
    });
  };

  // Subscribe to events when renderer connects
  ipcMain.handle("voice:subscribe", async (event) => {
    eventForwarder(event);
    return { success: true };
  });

  logger.info("Voice Assistant IPC handlers registered");
}

export default registerVoiceAssistantHandlers;
