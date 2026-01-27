/**
 * Voice Assistant Service
 * Real-time voice input/output for JoyCreate
 * 
 * Features:
 * - Push-to-talk and continuous listening modes
 * - Real-time transcription with Whisper
 * - Text-to-speech response with Bark/Coqui
 * - Wake word detection ("Hey Joy")
 * - Voice command processing
 */

import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import { app } from "electron";
import log from "electron-log";
import { spawn, ChildProcess } from "child_process";
import * as crypto from "crypto";

const logger = log.scope("voice_assistant");

// =============================================================================
// TYPES
// =============================================================================

export type VoiceAssistantId = string & { __brand: "VoiceAssistantId" };

export type VoiceMode = "push-to-talk" | "continuous" | "wake-word";
export type VoiceState = "idle" | "listening" | "processing" | "speaking" | "error";

export interface VoiceConfig {
  mode: VoiceMode;
  wakeWord: string;
  language: string;
  whisperModel: "tiny" | "base" | "small" | "medium" | "large";
  ttsModel: "bark" | "coqui" | "piper";
  ttsVoice: string;
  silenceThreshold: number;  // dB
  silenceDuration: number;   // ms before stopping
  autoSubmit: boolean;       // Auto-submit after transcription
  soundEffects: boolean;     // Play beeps
  continuousMode: boolean;   // Keep listening after response
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

export interface VoiceSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  transcriptions: TranscriptionResult[];
  commands: VoiceCommand[];
  state: VoiceState;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: VoiceConfig = {
  mode: "push-to-talk",
  wakeWord: "hey joy",
  language: "en",
  whisperModel: "base",
  ttsModel: "piper",
  ttsVoice: "en_US-lessac-medium",
  silenceThreshold: -40,
  silenceDuration: 1500,
  autoSubmit: true,
  soundEffects: true,
  continuousMode: false,
};

const VOICE_DATA_DIR = path.join(app.getPath("userData"), "voice");
const MODELS_DIR = path.join(VOICE_DATA_DIR, "models");
const RECORDINGS_DIR = path.join(VOICE_DATA_DIR, "recordings");
const TTS_CACHE_DIR = path.join(VOICE_DATA_DIR, "tts_cache");

// Voice command patterns
const COMMAND_PATTERNS: Array<{ pattern: RegExp; type: VoiceCommand["type"]; intent: string }> = [
  { pattern: /^(build|create|make)\s+(.+)/i, type: "build", intent: "create_app" },
  { pattern: /^(edit|change|modify|update)\s+(.+)/i, type: "edit", intent: "edit_code" },
  { pattern: /^(run|start|execute|launch)\s*(the\s+)?(app|project|server)?/i, type: "run", intent: "run_app" },
  { pattern: /^(stop|kill|terminate|end)\s*(the\s+)?(app|server)?/i, type: "stop", intent: "stop_app" },
  { pattern: /^(undo|revert|rollback)/i, type: "undo", intent: "undo_change" },
  { pattern: /^(help|what can you do|how do i)/i, type: "help", intent: "show_help" },
  { pattern: /^(go to|navigate to|open|show)\s+(.+)/i, type: "navigate", intent: "navigate" },
];

// =============================================================================
// VOICE ASSISTANT SERVICE
// =============================================================================

export class VoiceAssistant extends EventEmitter {
  private static instance: VoiceAssistant;
  
  private config: VoiceConfig = DEFAULT_CONFIG;
  private state: VoiceState = "idle";
  private currentSession: VoiceSession | null = null;
  private recordingProcess: ChildProcess | null = null;
  private audioBuffer: Buffer[] = [];
  private isInitialized = false;
  private wakeWordDetector: WakeWordDetector | null = null;
  
  private constructor() {
    super();
  }
  
  static getInstance(): VoiceAssistant {
    if (!VoiceAssistant.instance) {
      VoiceAssistant.instance = new VoiceAssistant();
    }
    return VoiceAssistant.instance;
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(config?: Partial<VoiceConfig>): Promise<void> {
    if (this.isInitialized) return;
    
    logger.info("Initializing Voice Assistant...");
    
    // Merge config
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Create directories
    await fs.mkdir(VOICE_DATA_DIR, { recursive: true });
    await fs.mkdir(MODELS_DIR, { recursive: true });
    await fs.mkdir(RECORDINGS_DIR, { recursive: true });
    await fs.mkdir(TTS_CACHE_DIR, { recursive: true });
    
    // Check for required tools
    const hasFFmpeg = await this.checkFFmpeg();
    if (!hasFFmpeg) {
      logger.warn("FFmpeg not found - some voice features may be limited");
    }
    
    // Initialize wake word detector if needed
    if (this.config.mode === "wake-word") {
      this.wakeWordDetector = new WakeWordDetector(this.config.wakeWord);
    }
    
    this.isInitialized = true;
    logger.info("Voice Assistant initialized", { config: this.config });
    this.emit("initialized", this.config);
  }
  
  async shutdown(): Promise<void> {
    await this.stopListening();
    this.wakeWordDetector?.stop();
    this.isInitialized = false;
    logger.info("Voice Assistant shut down");
  }
  
  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================
  
  getConfig(): VoiceConfig {
    return { ...this.config };
  }
  
  async updateConfig(updates: Partial<VoiceConfig>): Promise<VoiceConfig> {
    this.config = { ...this.config, ...updates };
    
    // Reinitialize wake word detector if mode changed
    if (updates.mode === "wake-word" && !this.wakeWordDetector) {
      this.wakeWordDetector = new WakeWordDetector(this.config.wakeWord);
    } else if (updates.mode !== "wake-word" && this.wakeWordDetector) {
      this.wakeWordDetector.stop();
      this.wakeWordDetector = null;
    }
    
    if (updates.wakeWord && this.wakeWordDetector) {
      this.wakeWordDetector.setWakeWord(updates.wakeWord);
    }
    
    this.emit("config:updated", this.config);
    return this.config;
  }
  
  getState(): VoiceState {
    return this.state;
  }
  
  // ===========================================================================
  // LISTENING
  // ===========================================================================
  
  async startListening(): Promise<string> {
    if (this.state !== "idle") {
      throw new Error(`Cannot start listening in state: ${this.state}`);
    }
    
    // Create new session
    const sessionId = crypto.randomUUID();
    this.currentSession = {
      id: sessionId,
      startedAt: Date.now(),
      transcriptions: [],
      commands: [],
      state: "listening",
    };
    
    this.setState("listening");
    this.audioBuffer = [];
    
    // Start recording
    await this.startRecording(sessionId);
    
    if (this.config.soundEffects) {
      this.emit("sound:start");
    }
    
    logger.info("Started listening", { sessionId });
    return sessionId;
  }
  
  async stopListening(): Promise<TranscriptionResult | null> {
    if (this.state !== "listening") {
      return null;
    }
    
    // Stop recording
    await this.stopRecording();
    
    if (this.config.soundEffects) {
      this.emit("sound:stop");
    }
    
    if (!this.currentSession) {
      this.setState("idle");
      return null;
    }
    
    this.setState("processing");
    
    // Process audio
    const audioPath = path.join(RECORDINGS_DIR, `${this.currentSession.id}.wav`);
    
    if (!existsSync(audioPath)) {
      logger.warn("No audio recorded");
      this.setState("idle");
      return null;
    }
    
    // Transcribe
    const transcription = await this.transcribe(audioPath);
    
    if (this.currentSession) {
      this.currentSession.transcriptions.push(transcription);
      this.currentSession.endedAt = Date.now();
    }
    
    // Parse commands if it looks like a voice command
    const command = this.parseCommand(transcription.text);
    if (command) {
      this.currentSession?.commands.push(command);
      this.emit("command", command);
    }
    
    this.setState("idle");
    this.emit("transcription", transcription);
    
    return transcription;
  }
  
  // ===========================================================================
  // RECORDING
  // ===========================================================================
  
  private async startRecording(sessionId: string): Promise<void> {
    const outputPath = path.join(RECORDINGS_DIR, `${sessionId}.wav`);
    
    // Use SoX or FFmpeg for recording
    const isWindows = process.platform === "win32";
    
    if (isWindows) {
      // Use FFmpeg with DirectShow on Windows
      this.recordingProcess = spawn("ffmpeg", [
        "-f", "dshow",
        "-i", "audio=@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\\wave_{00000000-0000-0000-0000-000000000000}",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        "-y",
        outputPath,
      ], { stdio: ["pipe", "pipe", "pipe"] });
    } else {
      // Use FFmpeg with ALSA on Linux or CoreAudio on macOS
      const inputDevice = process.platform === "darwin" 
        ? ["-f", "avfoundation", "-i", ":0"]
        : ["-f", "alsa", "-i", "default"];
      
      this.recordingProcess = spawn("ffmpeg", [
        ...inputDevice,
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        "-y",
        outputPath,
      ], { stdio: ["pipe", "pipe", "pipe"] });
    }
    
    this.recordingProcess.on("error", (error) => {
      logger.error("Recording error:", error);
      this.emit("error", { type: "recording", error: error.message });
    });
    
    this.recordingProcess.stderr?.on("data", (data) => {
      // FFmpeg outputs progress to stderr
      const output = data.toString();
      if (output.includes("size=")) {
        // Emit recording progress
        this.emit("recording:progress", { output });
      }
    });
  }
  
  private async stopRecording(): Promise<void> {
    if (this.recordingProcess) {
      // Send 'q' to FFmpeg to stop gracefully
      this.recordingProcess.stdin?.write("q");
      
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.recordingProcess?.kill("SIGKILL");
          resolve();
        }, 2000);
        
        this.recordingProcess?.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      
      this.recordingProcess = null;
    }
  }
  
  // ===========================================================================
  // TRANSCRIPTION
  // ===========================================================================
  
  async transcribe(audioPath: string): Promise<TranscriptionResult> {
    const id = crypto.randomUUID();
    const startTime = Date.now();
    
    // Use local Whisper model
    const result = await this.runWhisper(audioPath);
    
    const transcription: TranscriptionResult = {
      id,
      text: result.text,
      confidence: result.confidence,
      language: result.language || this.config.language,
      duration: Date.now() - startTime,
      segments: result.segments || [],
      isFinal: true,
      timestamp: Date.now(),
    };
    
    logger.info("Transcription complete", { 
      text: transcription.text.substring(0, 100),
      duration: transcription.duration,
    });
    
    return transcription;
  }
  
  private async runWhisper(audioPath: string): Promise<{
    text: string;
    confidence: number;
    language?: string;
    segments?: TranscriptionSegment[];
  }> {
    return new Promise((resolve, reject) => {
      const model = this.config.whisperModel;
      
      const script = `
import whisper
import json
import sys

model = whisper.load_model("${model}")
result = model.transcribe("${audioPath.replace(/\\/g, "/")}", language="${this.config.language}")

output = {
    "text": result["text"].strip(),
    "language": result.get("language", "${this.config.language}"),
    "segments": [
        {
            "id": i,
            "start": seg["start"],
            "end": seg["end"],
            "text": seg["text"].strip(),
            "confidence": seg.get("no_speech_prob", 0)
        }
        for i, seg in enumerate(result.get("segments", []))
    ]
}

print(json.dumps(output))
`;
      
      const pythonCmd = process.platform === "win32" ? "python" : "python3";
      const proc = spawn(pythonCmd, ["-c", script]);
      
      let stdout = "";
      let stderr = "";
      
      proc.stdout.on("data", (data) => { stdout += data.toString(); });
      proc.stderr.on("data", (data) => { stderr += data.toString(); });
      
      proc.on("exit", (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            resolve({
              text: result.text,
              confidence: 1 - (result.segments?.[0]?.confidence || 0),
              language: result.language,
              segments: result.segments,
            });
          } catch (e) {
            reject(new Error(`Failed to parse Whisper output: ${stdout}`));
          }
        } else {
          reject(new Error(`Whisper failed: ${stderr}`));
        }
      });
    });
  }
  
  // ===========================================================================
  // TEXT-TO-SPEECH
  // ===========================================================================
  
  async speak(request: TTSRequest): Promise<TTSResult> {
    const id = crypto.randomUUID();
    
    this.setState("speaking");
    this.emit("tts:start", { id, text: request.text });
    
    try {
      const audioPath = await this.generateSpeech(id, request);
      
      const result: TTSResult = {
        id,
        audioPath,
        duration: 0, // Will be filled in
        text: request.text,
      };
      
      // Get duration
      result.duration = await this.getAudioDuration(audioPath);
      
      this.emit("tts:ready", result);
      
      // Play audio
      await this.playAudio(audioPath);
      
      this.setState("idle");
      this.emit("tts:complete", result);
      
      return result;
    } catch (error) {
      this.setState("error");
      throw error;
    }
  }
  
  private async generateSpeech(id: string, request: TTSRequest): Promise<string> {
    const outputPath = path.join(TTS_CACHE_DIR, `${id}.wav`);
    
    // Check cache first
    const cacheKey = this.hashText(request.text + (request.voice || this.config.ttsVoice));
    const cachedPath = path.join(TTS_CACHE_DIR, `${cacheKey}.wav`);
    
    if (existsSync(cachedPath)) {
      logger.debug("Using cached TTS audio");
      return cachedPath;
    }
    
    // Generate using configured TTS model
    switch (this.config.ttsModel) {
      case "piper":
        await this.generateWithPiper(request, outputPath);
        break;
      case "bark":
        await this.generateWithBark(request, outputPath);
        break;
      case "coqui":
        await this.generateWithCoqui(request, outputPath);
        break;
    }
    
    // Cache the result
    await fs.copyFile(outputPath, cachedPath);
    
    return outputPath;
  }
  
  private async generateWithPiper(request: TTSRequest, outputPath: string): Promise<void> {
    const voice = request.voice || this.config.ttsVoice;
    const modelPath = path.join(MODELS_DIR, "piper", `${voice}.onnx`);
    
    return new Promise((resolve, reject) => {
      const proc = spawn("piper", [
        "--model", modelPath,
        "--output_file", outputPath,
      ]);
      
      proc.stdin?.write(request.text);
      proc.stdin?.end();
      
      proc.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Piper TTS failed with code ${code}`));
      });
      
      proc.on("error", reject);
    });
  }
  
  private async generateWithBark(request: TTSRequest, outputPath: string): Promise<void> {
    const script = `
import scipy.io.wavfile as wavfile
from bark import SAMPLE_RATE, generate_audio, preload_models

preload_models()
audio = generate_audio("${request.text.replace(/"/g, '\\"')}", history_prompt="${request.voice || 'v2/en_speaker_6'}")
wavfile.write("${outputPath.replace(/\\/g, "/")}", SAMPLE_RATE, audio)
`;
    
    return new Promise((resolve, reject) => {
      const pythonCmd = process.platform === "win32" ? "python" : "python3";
      const proc = spawn(pythonCmd, ["-c", script]);
      
      let stderr = "";
      proc.stderr?.on("data", (data) => { stderr += data.toString(); });
      
      proc.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Bark TTS failed: ${stderr}`));
      });
    });
  }
  
  private async generateWithCoqui(request: TTSRequest, outputPath: string): Promise<void> {
    const script = `
from TTS.api import TTS

tts = TTS(model_name="tts_models/en/ljspeech/tacotron2-DDC")
tts.tts_to_file(text="${request.text.replace(/"/g, '\\"')}", file_path="${outputPath.replace(/\\/g, "/")}")
`;
    
    return new Promise((resolve, reject) => {
      const pythonCmd = process.platform === "win32" ? "python" : "python3";
      const proc = spawn(pythonCmd, ["-c", script]);
      
      let stderr = "";
      proc.stderr?.on("data", (data) => { stderr += data.toString(); });
      
      proc.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Coqui TTS failed: ${stderr}`));
      });
    });
  }
  
  private async playAudio(audioPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === "win32";
      const isMac = process.platform === "darwin";
      
      let cmd: string;
      let args: string[];
      
      if (isWindows) {
        cmd = "powershell";
        args = ["-c", `(New-Object Media.SoundPlayer '${audioPath}').PlaySync()`];
      } else if (isMac) {
        cmd = "afplay";
        args = [audioPath];
      } else {
        cmd = "aplay";
        args = [audioPath];
      }
      
      const proc = spawn(cmd, args);
      
      proc.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Audio playback failed with code ${code}`));
      });
      
      proc.on("error", reject);
    });
  }
  
  // ===========================================================================
  // COMMAND PARSING
  // ===========================================================================
  
  parseCommand(text: string): VoiceCommand | null {
    const normalizedText = text.toLowerCase().trim();
    
    for (const { pattern, type, intent } of COMMAND_PATTERNS) {
      const match = normalizedText.match(pattern);
      if (match) {
        return {
          type,
          intent,
          entities: this.extractEntities(match),
          confidence: 0.9,
          rawText: text,
        };
      }
    }
    
    // No command pattern matched - treat as general query
    return {
      type: "custom",
      intent: "general_query",
      entities: {},
      confidence: 0.5,
      rawText: text,
    };
  }
  
  private extractEntities(match: RegExpMatchArray): Record<string, string> {
    const entities: Record<string, string> = {};
    
    // Extract captured groups
    for (let i = 1; i < match.length; i++) {
      if (match[i]) {
        entities[`param_${i}`] = match[i];
      }
    }
    
    return entities;
  }
  
  // ===========================================================================
  // UTILITIES
  // ===========================================================================
  
  private setState(state: VoiceState): void {
    const previousState = this.state;
    this.state = state;
    
    if (this.currentSession) {
      this.currentSession.state = state;
    }
    
    this.emit("state:changed", { previous: previousState, current: state });
  }
  
  private async checkFFmpeg(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn("ffmpeg", ["-version"]);
      proc.on("exit", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }
  
  private async getAudioDuration(audioPath: string): Promise<number> {
    return new Promise((resolve) => {
      const proc = spawn("ffprobe", [
        "-v", "quiet",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        audioPath,
      ]);
      
      let output = "";
      proc.stdout?.on("data", (data) => { output += data.toString(); });
      
      proc.on("exit", () => {
        resolve(parseFloat(output) * 1000 || 0);
      });
      
      proc.on("error", () => resolve(0));
    });
  }
  
  private hashText(text: string): string {
    return crypto.createHash("md5").update(text).digest("hex").substring(0, 16);
  }
  
  // ===========================================================================
  // MODEL MANAGEMENT
  // ===========================================================================
  
  async downloadWhisperModel(model: VoiceConfig["whisperModel"]): Promise<void> {
    logger.info(`Downloading Whisper model: ${model}`);
    
    const script = `
import whisper
whisper.load_model("${model}")
print("Model downloaded successfully")
`;
    
    return new Promise((resolve, reject) => {
      const pythonCmd = process.platform === "win32" ? "python" : "python3";
      const proc = spawn(pythonCmd, ["-c", script]);
      
      proc.on("exit", (code) => {
        if (code === 0) {
          this.emit("model:downloaded", { model, type: "whisper" });
          resolve();
        } else {
          reject(new Error(`Failed to download Whisper model: ${model}`));
        }
      });
    });
  }
  
  async getInstalledModels(): Promise<{
    whisper: string[];
    tts: string[];
  }> {
    const whisperModels: string[] = [];
    const ttsModels: string[] = [];
    
    // Check Whisper models
    const whisperDir = path.join(MODELS_DIR, "whisper");
    if (existsSync(whisperDir)) {
      const files = await fs.readdir(whisperDir);
      whisperModels.push(...files.filter(f => f.endsWith(".pt")));
    }
    
    // Check TTS models (Piper)
    const piperDir = path.join(MODELS_DIR, "piper");
    if (existsSync(piperDir)) {
      const files = await fs.readdir(piperDir);
      ttsModels.push(...files.filter(f => f.endsWith(".onnx")));
    }
    
    return { whisper: whisperModels, tts: ttsModels };
  }
}

// =============================================================================
// WAKE WORD DETECTOR
// =============================================================================

class WakeWordDetector {
  private wakeWord: string;
  private isRunning = false;
  private process: ChildProcess | null = null;
  
  constructor(wakeWord: string) {
    this.wakeWord = wakeWord.toLowerCase();
  }
  
  setWakeWord(word: string): void {
    this.wakeWord = word.toLowerCase();
  }
  
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    // Wake word detection would use Porcupine or similar
    logger.info(`Wake word detector started for: "${this.wakeWord}"`);
  }
  
  stop(): void {
    this.isRunning = false;
    this.process?.kill();
    this.process = null;
    logger.info("Wake word detector stopped");
  }
}

// =============================================================================
// EXPORT SINGLETON
// =============================================================================

export const voiceAssistant = VoiceAssistant.getInstance();
