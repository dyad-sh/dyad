import type { WebContents } from "electron";
import { v4 as uuidv4 } from "uuid";
import { generateText, streamText } from "ai";
import log from "electron-log";
import { readSettings } from "../../../main/settings";
import { safeSend } from "../safe_sender";
import { cancelOrphanedBaseStream } from "../stream_text_utils";
import { getModelClient } from "../get_model_client";
import { getMaxTokens, getTemperature } from "../token_utils";
import { getChatAgentModel } from "@/lib/chat_agent_model";
import { buildSocialAccountContext } from "@/lib/social_account_context";
import type { LargeLanguageModel, UserSettings } from "@/lib/schemas";
import {
  JarvisStateMachine,
  INTERRUPTIBLE_STATES,
  MIC_ACTIVE_STATES,
  TURN_STARTABLE_STATES,
  type JarvisState,
} from "@/shared/jarvis/state_machine";
import { StreamingSentenceBuffer } from "@/shared/jarvis/sentence_buffer";
import { jarvisEvents, type JarvisActivityEvent } from "../../types/jarvis";
import {
  MockSttSession,
  MockTtsSession,
  type RealtimeSttSession,
  type SttFactory,
  type StreamingTtsSession,
  type TtsFactory,
} from "./voice_providers";
import { ElevenLabsSttSession } from "./elevenlabs_stt";
import { resolveBrainAgent, type JarvisBrainAgent } from "./brain_agent";
import { OpenAiRealtimeSession, REALTIME_SAMPLE_RATE } from "./openai_realtime";
import {
  ElevenLabsTtsSession,
  sampleRateFromOutputFormat,
} from "./elevenlabs_tts";
import {
  DEFAULT_ELEVENLABS_TTS_MODEL,
  DEFAULT_ELEVENLABS_VOICE_ID,
} from "./elevenlabs_http_tts";

const logger = log.scope("jarvis-session");

export const JARVIS_SYSTEM_PROMPT = [
  "You are Meta Human OS, the application's live voice interface and orchestration assistant.",
  "Communicate naturally, calmly and efficiently. Keep spoken responses concise unless the user requests detail — answers are read aloud, so avoid markdown, bullet lists, code blocks and URLs; describe them in plain speech instead.",
  "You can navigate the application and perform actions only through the tools made available to you. Never claim that an action succeeded until its tool returns success.",
  "Ask for confirmation before sensitive or destructive actions.",
  "When delegating work, provide brief progress updates without exposing private reasoning.",
  "Use the current application context to resolve references such as 'this', 'that file', 'the current project' and 'open it'.",
  "Prefer taking the requested action over explaining how the user could do it manually.",
].join(" ");

export const DEFAULT_GREETING = "Meta Human OS online. How can I assist?";

const END_SESSION_PHRASES = ["end session", "go offline", "goodbye jarvis"];

const DEFAULT_STT_MODEL = "scribe_v2_realtime";
const DEFAULT_OUTPUT_FORMAT = "pcm_24000";
const DEFAULT_INACTIVITY_TIMEOUT_SECONDS = 300;
const MAX_HISTORY_ENTRIES = 40;
/** Some self-hosted agent endpoints answer slowly; fail loudly rather than hang. */
const TURN_TIMEOUT_MS = 120_000;

type TranscriptEntry = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export interface JarvisLlmRequest {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  abortSignal: AbortSignal;
  onDelta: (delta: string) => void;
}

/** Injectable LLM streamer so tests run without a provider. */
export type JarvisLlmStreamer = (request: JarvisLlmRequest) => Promise<string>;

export interface JarvisSessionConfig {
  sessionId: string;
  sender: WebContents;
  mock: boolean;
  /** Overrides for tests. */
  settings?: UserSettings;
  sttFactory?: SttFactory;
  ttsFactory?: TtsFactory;
  llm?: JarvisLlmStreamer;
  brainAgent?: JarvisBrainAgent | null;
  onEnded?: (sessionId: string) => void;
}

interface ActiveTurn {
  id: string;
  abortController: AbortController;
  buffer: StreamingSentenceBuffer;
  tts: StreamingTtsSession | null;
  llmDone: boolean;
  ttsStarted: boolean;
  cancelled: boolean;
}

export function resolveJarvisModel(settings: UserSettings): LargeLanguageModel {
  const jarvis = settings.jarvis;
  if (
    (jarvis?.modelMode === "voice" || jarvis?.modelMode === "custom") &&
    jarvis.voiceModel
  ) {
    return jarvis.voiceModel;
  }
  // "automatic" and "chat" both use the app's chat model for now; automatic
  // per-request routing arrives with the tool/agent phases.
  return getChatAgentModel(settings);
}

export class JarvisSession {
  readonly sessionId: string;
  private readonly sender: WebContents;
  private readonly machine = new JarvisStateMachine();
  private readonly settings: UserSettings;
  private readonly mock: boolean;
  private readonly llm: JarvisLlmStreamer;
  private readonly ttsFactory: TtsFactory | null;
  private stt: RealtimeSttSession | null = null;
  private transcript: TranscriptEntry[] = [];
  private turn: ActiveTurn | null = null;
  /**
   * Speech not tied to a turn (greeting, farewells). Tracked so a barge-in
   * or stop can cut it — otherwise the provider keeps streaming audio at the
   * user after they have started talking.
   */
  private standaloneSpeech = new Set<StreamingTtsSession>();
  /** `undefined` = not yet resolved; `null` = no agent brain configured. */
  private brainAgentResolved: JarvisBrainAgent | null | undefined;
  /** Speech-to-speech engine; when set, the STT/LLM/TTS pipeline is unused. */
  private realtime: OpenAiRealtimeSession | null = null;
  private realtimeTurnId: string | null = null;
  private inactivityTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly onEnded?: (sessionId: string) => void;
  private readonly config: JarvisSessionConfig;

  constructor(config: JarvisSessionConfig) {
    this.config = config;
    this.sessionId = config.sessionId;
    this.sender = config.sender;
    this.mock = config.mock;
    this.settings = config.settings ?? readSettings();
    this.llm = config.llm ?? this.defaultLlmStreamer;
    this.ttsFactory = this.resolveTtsFactory();
    this.onEnded = config.onEnded;
    this.machine.onChange((state, previous) => {
      this.emit(jarvisEvents.state.channel, {
        sessionId: this.sessionId,
        state,
        previous,
      });
    });
  }

  get state(): JarvisState {
    return this.machine.state;
  }

  get voiceConfigured(): boolean {
    if (this.mock) return true;
    // The realtime engine carries its own speech in and out, so it needs an
    // OpenAI key rather than an ElevenLabs one.
    if (this.settings.jarvis?.voiceEngine === "realtime") {
      return !!this.openAiKey;
    }
    return !!this.settings.jarvis?.elevenLabsApiKey?.value;
  }

  get model(): LargeLanguageModel {
    const agent = this.brainAgent;
    if (agent) {
      return { provider: `agent:${agent.name}`, name: agent.modelName };
    }
    return resolveJarvisModel(this.settings);
  }

  /**
   * The Agent OS agent selected as the voice brain, if any. Resolved once
   * per session so a mid-conversation edit on the Agents page cannot swap
   * the model underneath an in-flight turn.
   */
  private get brainAgent(): JarvisBrainAgent | null {
    if (this.brainAgentResolved === undefined) {
      this.brainAgentResolved = this.config.brainAgent ?? this.resolveBrain();
    }
    return this.brainAgentResolved;
  }

  private resolveBrain(): JarvisBrainAgent | null {
    if (this.mock) return null;
    try {
      return resolveBrainAgent(this.settings);
    } catch (error) {
      logger.warn("Could not resolve the Meta Human OS brain agent", error);
      return null;
    }
  }

  /** True when this session runs on the OpenAI Realtime engine. */
  get usesRealtime(): boolean {
    return (
      !this.mock &&
      this.settings.jarvis?.voiceEngine === "realtime" &&
      !!this.openAiKey
    );
  }

  /** Rate the renderer should capture at for the active engine. */
  get captureSampleRate(): number {
    return this.usesRealtime ? REALTIME_SAMPLE_RATE : 16000;
  }

  private get openAiKey(): string | undefined {
    return this.settings.providerSettings?.openai?.apiKey?.value;
  }

  get greeting(): string {
    return this.settings.jarvis?.greeting?.trim() || DEFAULT_GREETING;
  }

  async start(): Promise<void> {
    this.machine.transition("connecting");
    const startedAt = Date.now();
    const startingActivity = this.activity({
      type: "session",
      title: "Session starting",
      status: "running",
    });

    if (this.usesRealtime) {
      this.startRealtime();
    } else {
      try {
        this.stt = await this.createStt();
      } catch (error) {
        logger.error("Failed to start STT", error);
        this.stt = null;
      }
    }

    const listenOnOpen = this.settings.jarvis?.startListeningOnOpen ?? true;
    const canListen = this.stt != null || this.realtime != null;
    this.machine.transition(listenOnOpen && canListen ? "listening" : "idle");
    // Resolve the "starting" row rather than leaving it spinning forever,
    // which reads as a session stuck on connect.
    this.activity({
      ...startingActivity,
      status: "success",
      durationMs: Date.now() - startedAt,
    });
    this.activity({
      type: "session",
      title: "Meta Human OS online",
      summary: this.realtime
        ? "Realtime voice session established"
        : this.stt
          ? "Live voice session established"
          : "Voice input unavailable — add an ElevenLabs API key to talk; text mode is active",
      status: this.stt || this.realtime ? "success" : "warning",
    });
    const agent = this.brainAgent;
    this.activity({
      type: agent ? "agent" : "model",
      title: agent
        ? `Brain: ${agent.name}`
        : `Model: ${this.model.provider}/${this.model.name}`,
      summary: agent ? `${agent.modelName} via ${agent.endpoint}` : undefined,
      status: "success",
    });

    // Record the greeting. On the realtime engine the model produces its own
    // speech, so synthesising it separately would talk over the session.
    const greetingId = uuidv4();
    this.pushTranscript({
      id: greetingId,
      role: "assistant",
      text: this.greeting,
    });
    if (!this.realtime) {
      this.speakStandalone(greetingId, this.greeting);
    }
    this.armInactivityTimer();
  }

  handleAudioChunk(base64Chunk: string): void {
    if (this.stopped) return;
    if (!MIC_ACTIVE_STATES.includes(this.machine.state)) return;
    const audio = Buffer.from(base64Chunk, "base64");
    if (this.realtime) {
      this.realtime.sendAudio(audio);
      return;
    }
    this.stt?.sendAudio(audio);
  }

  handleSpeechActivity(kind: "start" | "end"): void {
    if (this.stopped) return;
    this.armInactivityTimer();
    // The realtime service performs its own voice activity detection, so
    // renderer hints would only fight it.
    if (this.realtime) return;
    if (kind === "start") {
      const allowInterruptions =
        this.settings.jarvis?.allowInterruptions ?? true;
      if (
        allowInterruptions &&
        INTERRUPTIBLE_STATES.includes(this.machine.state)
      ) {
        this.interrupt("barge-in");
      }
      this.machine.transition("userSpeaking");
    } else {
      this.machine.transition("transcribing");
    }
    this.stt?.notifySpeechActivity(kind);
  }

  handleTextTurn(text: string): void {
    if (this.stopped) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    this.armInactivityTimer();
    if (INTERRUPTIBLE_STATES.includes(this.machine.state)) {
      this.interrupt("barge-in");
    }
    this.commitUserText(trimmed);
  }

  interrupt(reason: "barge-in" | "stop-button" | "mute" | "navigation"): void {
    if (this.stopped) return;
    this.cancelStandaloneSpeech();
    this.realtime?.cancelResponse();
    const turn = this.turn;
    if (turn && !turn.cancelled) {
      turn.cancelled = true;
      turn.abortController.abort();
      turn.buffer.cancel();
      turn.tts?.cancel();
      this.emit(jarvisEvents.audioDone.channel, {
        sessionId: this.sessionId,
        turnId: turn.id,
      });
      this.turn = null;
      this.activity({
        type: "speech",
        title: reason === "barge-in" ? "Interrupted by user" : "Speech stopped",
        status: "warning",
      });
    }
    if (this.machine.transition("interrupted")) {
      // Barge-in continues into userSpeaking via speech activity; explicit
      // stops settle back into listening.
      if (reason !== "barge-in") {
        this.machine.transition("listening");
      }
    }
  }

  respondToConfirmation(_requestId: string, _approved: boolean): void {
    // Confirmation flow lands with the tool/permission phase. Accepting the
    // IPC call now keeps the contract stable for the renderer.
  }

  stop(reason: string): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.cancelStandaloneSpeech();
    const turn = this.turn;
    if (turn) {
      turn.cancelled = true;
      turn.abortController.abort();
      turn.buffer.cancel();
      turn.tts?.cancel();
      this.turn = null;
    }
    this.stt?.close();
    this.stt = null;
    this.realtime?.close();
    this.realtime = null;
    this.machine.transition("disconnecting");
    this.machine.transition("offline");
    this.activity({
      type: "session",
      title: "Session ended",
      summary: reason,
      status: "success",
    });
    this.emit(jarvisEvents.ended.channel, {
      sessionId: this.sessionId,
      reason,
    });
    this.onEnded?.(this.sessionId);
  }

  // ---------------------------------------------------------------------------

  /**
   * Bring up the speech-to-speech engine and map its events onto the same
   * transcript/audio/state events the pipeline emits, so the workspace UI
   * does not care which engine is running.
   */
  private startRealtime(): void {
    const apiKey = this.openAiKey;
    if (!apiKey) return;

    this.realtime = new OpenAiRealtimeSession(
      {
        apiKey,
        model: this.settings.jarvis?.realtimeModel,
        voice: this.settings.jarvis?.realtimeVoice,
        instructions: `${JARVIS_SYSTEM_PROMPT}${buildSocialAccountContext(readSettings())}`,
      },
      {
        onReady: () => {
          this.activity({
            type: "session",
            title: "Realtime voice ready",
            summary: "OpenAI is handling listening, turn-taking and speech.",
            status: "success",
          });
        },
        onSpeechStarted: () => {
          // Barge-in: drop whatever we are still playing.
          if (INTERRUPTIBLE_STATES.includes(this.machine.state)) {
            this.realtime?.cancelResponse();
            this.emit(jarvisEvents.audioDone.channel, {
              sessionId: this.sessionId,
              turnId: this.realtimeTurnId ?? "realtime",
            });
          }
          this.machine.transition("userSpeaking");
        },
        onSpeechStopped: () => {
          this.machine.transition("transcribing");
        },
        onUserTranscript: (text: string) => {
          this.pushTranscript({ id: uuidv4(), role: "user", text });
          this.activity({
            type: "speech",
            title: "Heard you",
            summary: text.length > 120 ? `${text.slice(0, 120)}…` : text,
            status: "success",
          });
          this.armInactivityTimer();
          const normalized = text.toLowerCase();
          if (
            END_SESSION_PHRASES.some((phrase) => normalized.includes(phrase))
          ) {
            this.stop("Ended by voice command");
          }
        },
        onAssistantDelta: (delta: string) => {
          if (!this.realtimeTurnId) {
            this.realtimeTurnId = uuidv4();
            this.machine.transition("thinking");
          }
          this.emit(jarvisEvents.assistantDelta.channel, {
            sessionId: this.sessionId,
            turnId: this.realtimeTurnId,
            delta,
          });
        },
        onAudio: (pcm16: Buffer, sampleRate: number) => {
          this.realtimeTurnId ??= uuidv4();
          this.machine.transition("speaking");
          this.emit(jarvisEvents.audioChunk.channel, {
            sessionId: this.sessionId,
            turnId: this.realtimeTurnId,
            chunk: pcm16.toString("base64"),
            sampleRate,
          });
        },
        onResponseDone: (text: string) => {
          const turnId = this.realtimeTurnId ?? uuidv4();
          this.realtimeTurnId = null;
          if (text) {
            this.pushTranscript({ id: uuidv4(), role: "assistant", text });
            this.emit(jarvisEvents.assistantDone.channel, {
              sessionId: this.sessionId,
              turnId,
              text,
            });
          }
          this.emit(jarvisEvents.audioDone.channel, {
            sessionId: this.sessionId,
            turnId,
          });
          if (!this.machine.transition("listening")) {
            this.machine.transition("idle");
          }
          this.armInactivityTimer();
        },
        onError: (message: string) => this.reportError(message, true),
        onClosed: (reason: string) => {
          if (this.stopped) return;
          this.reportError(
            `The realtime voice connection closed (${reason}).`,
            true,
          );
        },
      },
    );
  }

  private async createStt(): Promise<RealtimeSttSession | null> {
    const callbacks = {
      onPartial: (text: string) => {
        if (this.stopped) return;
        this.machine.transition("userSpeaking");
        this.emit(jarvisEvents.partialTranscript.channel, {
          sessionId: this.sessionId,
          text,
        });
      },
      onCommitted: (text: string) => this.commitUserText(text),
      onSpeechStart: () => {},
      onSpeechEnd: () => {},
      onStatus: (status: {
        title: string;
        summary?: string;
        level: "info" | "warning";
      }) =>
        this.activity({
          type: "speech",
          title: status.title,
          summary: status.summary,
          status: status.level === "warning" ? "warning" : "success",
        }),
      onError: (message: string) => this.reportError(message, true),
    };

    if (this.config.sttFactory) {
      return this.config.sttFactory(callbacks);
    }
    if (this.mock) {
      return new MockSttSession(callbacks, "");
    }
    const jarvis = this.settings.jarvis;
    const apiKey = jarvis?.elevenLabsApiKey?.value;
    if (!apiKey) {
      return null;
    }
    return new ElevenLabsSttSession(
      {
        apiKey,
        modelId: jarvis?.sttModelId || DEFAULT_STT_MODEL,
        languageCode: jarvis?.language,
        autoDetectLanguage: jarvis?.autoDetectLanguage ?? true,
        vadThreshold: jarvis?.vadSensitivity,
        silenceTimeoutMs: jarvis?.silenceTimeoutMs,
      },
      callbacks,
    );
  }

  private resolveTtsFactory(): TtsFactory | null {
    if (this.config.ttsFactory) return this.config.ttsFactory;
    if (this.mock) {
      return async (callbacks) => new MockTtsSession(callbacks);
    }
    const jarvis = this.settings.jarvis;
    const apiKey = jarvis?.elevenLabsApiKey?.value;
    if (!apiKey) return null;
    const outputFormat = jarvis?.outputFormat || DEFAULT_OUTPUT_FORMAT;
    if (!outputFormat.startsWith("pcm_")) {
      logger.warn(
        `Unsupported Meta Human OS output format ${outputFormat}; using ${DEFAULT_OUTPUT_FORMAT}`,
      );
    }
    return async (callbacks) =>
      new ElevenLabsTtsSession(
        {
          apiKey,
          voiceId: jarvis?.voiceId || DEFAULT_ELEVENLABS_VOICE_ID,
          modelId: jarvis?.ttsModelId || DEFAULT_ELEVENLABS_TTS_MODEL,
          outputFormat: outputFormat.startsWith("pcm_")
            ? outputFormat
            : DEFAULT_OUTPUT_FORMAT,
          stability: jarvis?.stability,
          similarityBoost: jarvis?.similarityBoost,
          speed: jarvis?.speed,
          streamingLatency: jarvis?.streamingLatency,
        },
        callbacks,
      );
  }

  private commitUserText(text: string): void {
    if (this.stopped) return;
    const entryId = uuidv4();
    this.pushTranscript({ id: entryId, role: "user", text });
    this.activity({
      type: "speech",
      title: "Heard you",
      summary: text.length > 120 ? `${text.slice(0, 120)}…` : text,
      status: "success",
    });
    this.armInactivityTimer();

    const normalized = text.toLowerCase();
    if (END_SESSION_PHRASES.some((phrase) => normalized.includes(phrase))) {
      this.stop("Ended by voice command");
      return;
    }

    if (!TURN_STARTABLE_STATES.includes(this.machine.state)) {
      logger.log(
        `Dropping committed transcript in state ${this.machine.state}: interruptions disabled`,
      );
      return;
    }
    void this.startTurn(text);
  }

  private async startTurn(_userText: string): Promise<void> {
    if (this.turn) {
      // A turn is already running; the state machine should have prevented
      // this, but never run two.
      return;
    }
    if (!this.machine.transition("thinking")) return;

    const turnId = uuidv4();
    const abortController = new AbortController();
    // A brain endpoint that stalls must not leave the orb spinning forever.
    const turnTimeout = setTimeout(() => {
      if (!abortController.signal.aborted) {
        logger.warn("Turn timed out waiting for the model; aborting.");
        abortController.abort();
      }
    }, TURN_TIMEOUT_MS);
    const sampleRate = sampleRateFromOutputFormat(
      this.settings.jarvis?.outputFormat || DEFAULT_OUTPUT_FORMAT,
    );

    const turn: ActiveTurn = {
      id: turnId,
      abortController,
      tts: null,
      llmDone: false,
      ttsStarted: false,
      cancelled: false,
      buffer: new StreamingSentenceBuffer({
        onFlush: (chunk) => {
          void this.speakChunk(turn, chunk, sampleRate);
        },
      }),
    };
    this.turn = turn;

    const generatingActivity = this.activity({
      type: "model",
      title: "Generating response",
      summary: `${this.model.provider}/${this.model.name}`,
      status: "running",
    });
    const startedAt = Date.now();

    let assistantText = "";
    try {
      assistantText = await this.llm({
        system: `${JARVIS_SYSTEM_PROMPT}${buildSocialAccountContext(readSettings())}`,
        messages: this.historyForLlm(),
        abortSignal: abortController.signal,
        onDelta: (delta) => {
          if (turn.cancelled) return;
          this.emit(jarvisEvents.assistantDelta.channel, {
            sessionId: this.sessionId,
            turnId,
            delta,
          });
          turn.buffer.push(delta);
        },
      });
    } catch (error) {
      clearTimeout(turnTimeout);
      if (turn.cancelled) return;
      if ((error as Error)?.name === "AbortError") {
        // Either a barge-in (handled elsewhere) or the timeout above.
        if (abortController.signal.aborted && !turn.cancelled) {
          this.reportError(
            "The model did not respond in time. Check the agent endpoint in Hermes Agents.",
            true,
          );
          this.turn = null;
          if (!this.machine.transition("listening")) {
            this.machine.transition("idle");
          }
        }
        return;
      }
      logger.error("Meta Human OS LLM turn failed", error);
      this.activity({
        ...generatingActivity,
        status: "failed",
        durationMs: Date.now() - startedAt,
      });
      this.reportError(
        error instanceof Error
          ? error.message
          : "The language model is unavailable.",
        true,
      );
      this.turn = null;
      if (!this.machine.transition("listening")) {
        this.machine.transition("idle");
      }
      return;
    }

    clearTimeout(turnTimeout);
    if (turn.cancelled) return;
    turn.llmDone = true;
    turn.buffer.finish();
    turn.tts?.finish();

    this.activity({
      ...generatingActivity,
      status: "success",
      durationMs: Date.now() - startedAt,
    });

    const finalText = assistantText.trim();
    if (finalText) {
      this.pushTranscript({ id: uuidv4(), role: "assistant", text: finalText });
      this.emit(jarvisEvents.assistantDone.channel, {
        sessionId: this.sessionId,
        turnId,
        text: finalText,
      });
    }

    // Without TTS (text mode) the turn completes as soon as the LLM does.
    if (!turn.tts) {
      this.finishTurn(turn);
    }
  }

  private async speakChunk(
    turn: ActiveTurn,
    chunk: string,
    _sampleRate: number,
  ): Promise<void> {
    if (turn.cancelled || this.stopped) return;
    if (!this.ttsFactory) return;
    if (!turn.tts) {
      try {
        turn.tts = await this.ttsFactory({
          onAudio: (pcm16, rate) => {
            if (turn.cancelled) return;
            if (!turn.ttsStarted) {
              turn.ttsStarted = true;
              this.machine.transition("speaking");
            }
            this.emit(jarvisEvents.audioChunk.channel, {
              sessionId: this.sessionId,
              turnId: turn.id,
              chunk: pcm16.toString("base64"),
              sampleRate: rate,
            });
          },
          onDone: () => {
            if (turn.cancelled) return;
            this.emit(jarvisEvents.audioDone.channel, {
              sessionId: this.sessionId,
              turnId: turn.id,
            });
            this.finishTurn(turn);
          },
          onError: (message) => {
            if (turn.cancelled) return;
            this.reportError(message, true);
            this.finishTurn(turn);
          },
        });
      } catch (error) {
        logger.error("Failed to start TTS", error);
        turn.tts = null;
        return;
      }
      if (turn.cancelled) {
        turn.tts.cancel();
        return;
      }
    }
    turn.tts.speak(chunk);
    if (turn.llmDone) {
      // The buffer flushed after the stream already ended (finish() path
      // races with async TTS creation) — make sure the utterance terminates.
      turn.tts.finish();
    }
  }

  private finishTurn(turn: ActiveTurn): void {
    if (this.turn === turn) {
      this.turn = null;
    }
    if (turn.cancelled || this.stopped) return;
    const continueListening =
      this.settings.jarvis?.continueListeningAfterResponse ?? true;
    if (continueListening && this.stt) {
      this.machine.transition("listening");
    } else {
      this.machine.transition("idle");
    }
    this.armInactivityTimer();
  }

  /** Speak text outside a turn (greeting, farewells). */
  private speakStandalone(turnId: string, text: string): void {
    if (!this.ttsFactory) return;
    void (async () => {
      let session: StreamingTtsSession | null = null;
      const settle = () => {
        if (session) this.standaloneSpeech.delete(session);
        // Standalone speech never leaves the session mid-turn, so fall back
        // to listening (or idle when the mic is unavailable).
        if (!this.machine.transition("listening")) {
          this.machine.transition("idle");
        }
      };
      try {
        session = await this.ttsFactory!({
          onAudio: (pcm16, rate) => {
            if (this.stopped || !this.standaloneSpeech.has(session!)) return;
            this.machine.transition("speaking");
            this.emit(jarvisEvents.audioChunk.channel, {
              sessionId: this.sessionId,
              turnId,
              chunk: pcm16.toString("base64"),
              sampleRate: rate,
            });
          },
          onDone: () => {
            if (this.stopped || !this.standaloneSpeech.has(session!)) return;
            this.emit(jarvisEvents.audioDone.channel, {
              sessionId: this.sessionId,
              turnId,
            });
            settle();
          },
          onError: (message) => {
            logger.warn(`Standalone TTS failed: ${message}`);
            settle();
          },
        });
        if (this.stopped) {
          session.cancel();
          return;
        }
        this.standaloneSpeech.add(session);
        session.speak(text);
        session.finish();
      } catch (error) {
        logger.warn("Standalone speech failed", error);
        settle();
      }
    })();
  }

  private cancelStandaloneSpeech(): void {
    for (const session of this.standaloneSpeech) {
      session.cancel();
    }
    this.standaloneSpeech.clear();
  }

  private historyForLlm(): { role: "user" | "assistant"; content: string }[] {
    return this.transcript
      .slice(-MAX_HISTORY_ENTRIES)
      .map((entry) => ({ role: entry.role, content: entry.text }));
  }

  private defaultLlmStreamer: JarvisLlmStreamer = async (request) => {
    // A brain agent registered on the Agents page wins over the model roles:
    // it is an explicit per-agent endpoint choice, not a fallback.
    const agent = this.brainAgent;
    const model = resolveJarvisModel(this.settings);
    const languageModel = agent
      ? agent.model
      : (await getModelClient(model, this.settings)).modelClient.model;
    const maxOutputTokens = agent ? 2048 : await getMaxTokens(model);
    const temperature = agent ? 0.7 : await getTemperature(model);

    const common = {
      model: languageModel,
      system: request.system,
      messages: request.messages,
      maxOutputTokens:
        maxOutputTokens != null ? Math.min(maxOutputTokens, 2048) : 2048,
      temperature,
      maxRetries: 1,
      abortSignal: request.abortSignal,
    };

    let text = "";
    let streamError: unknown = null;
    try {
      const stream = streamText({
        ...common,
        onError: (error) => {
          streamError = (error as { error?: unknown })?.error ?? error;
        },
      });

      const fullStream = stream.fullStream;
      cancelOrphanedBaseStream(stream);

      for await (const part of fullStream) {
        if (request.abortSignal.aborted) break;
        if (part.type === "text-delta") {
          text += part.text;
          request.onDelta(part.text);
        }
      }
    } catch (error) {
      streamError = error;
    }

    if (text || request.abortSignal.aborted) return text;

    // Not every OpenAI-compatible endpoint honours `stream: true`. Some — the
    // Hermes agent endpoints among them — answer a streaming request with a
    // single JSON body, so the stream yields nothing and the turn would hang
    // forever. Fall back to a plain completion instead of waiting.
    logger.warn(
      "Streaming produced no text; retrying without streaming.",
      streamError instanceof Error ? streamError.message : streamError,
    );
    const { text: completed } = await generateText(common);
    const finalText = completed.trim();
    if (!finalText) {
      const detail =
        streamError instanceof Error
          ? streamError.message
          : streamError
            ? String(streamError)
            : "The model returned an empty response.";
      throw new Error(detail);
    }
    request.onDelta(finalText);
    return finalText;
  };

  private pushTranscript(entry: TranscriptEntry): void {
    this.transcript.push(entry);
    this.emit(jarvisEvents.committedTranscript.channel, {
      sessionId: this.sessionId,
      entryId: entry.id,
      role: entry.role,
      text: entry.text,
    });
  }

  private activity(
    partial: Omit<
      JarvisActivityEvent,
      "id" | "sessionId" | "timestamp" | "isUserVisible"
    > &
      Partial<Pick<JarvisActivityEvent, "id" | "isUserVisible">>,
  ): JarvisActivityEvent {
    const event: JarvisActivityEvent = {
      id: partial.id ?? uuidv4(),
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      isUserVisible: partial.isUserVisible ?? true,
      ...partial,
    };
    this.emit(jarvisEvents.activity.channel, event);
    return event;
  }

  private reportError(message: string, recoverable: boolean): void {
    this.activity({
      type: "error",
      title: "Error",
      summary: message,
      status: "failed",
    });
    this.emit(jarvisEvents.error.channel, {
      sessionId: this.sessionId,
      message,
      recoverable,
    });
  }

  private armInactivityTimer(): void {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    if (this.stopped) return;
    const seconds =
      this.settings.jarvis?.inactivityTimeoutSeconds ??
      DEFAULT_INACTIVITY_TIMEOUT_SECONDS;
    if (seconds <= 0) return;
    this.inactivityTimer = setTimeout(() => {
      this.stop("Inactivity timeout");
    }, seconds * 1000);
  }

  private emit(channel: string, payload: unknown): void {
    safeSend(this.sender, channel, payload);
  }
}
