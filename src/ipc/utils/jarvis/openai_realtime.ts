import WebSocket from "ws";
import log from "electron-log";

const logger = log.scope("jarvis-realtime");

/**
 * Speech-to-speech voice session over the OpenAI Realtime API.
 *
 * Unlike the ElevenLabs pipeline (transcribe → LLM → synthesise), the model
 * receives audio and answers with audio on one socket, handling voice activity
 * detection, turn-taking and interruption itself. That removes the parts of
 * the pipeline most prone to stalling.
 *
 * The API key never leaves the main process.
 */

/** The Realtime API speaks 24 kHz mono PCM16 in both directions. */
export const REALTIME_SAMPLE_RATE = 24000;

export const DEFAULT_REALTIME_MODEL = "gpt-realtime-2.1";
export const DEFAULT_REALTIME_VOICE = "marin";

export interface RealtimeVoiceCallbacks {
  /** The socket is configured and ready for audio. */
  onReady: () => void;
  /** Final transcript of what the user said. */
  onUserTranscript: (text: string) => void;
  /** Assistant reply text, streamed as it is spoken. */
  onAssistantDelta: (delta: string) => void;
  /** Assistant audio for playback. */
  onAudio: (pcm16: Buffer, sampleRate: number) => void;
  /** The user started speaking — the cue to duck our own playback. */
  onSpeechStarted: () => void;
  onSpeechStopped: () => void;
  /** A full assistant turn finished; carries the complete text if known. */
  onResponseDone: (text: string) => void;
  onError: (message: string) => void;
  onClosed: (reason: string) => void;
}

export interface OpenAiRealtimeOptions {
  apiKey: string;
  model?: string;
  voice?: string;
  instructions: string;
  /** Model used to transcribe the user's own speech. */
  transcriptionModel?: string;
}

export class OpenAiRealtimeSession {
  private ws: WebSocket;
  private ready = false;
  private closed = false;
  private pending: Buffer[] = [];
  private assistantText = "";

  constructor(
    private options: OpenAiRealtimeOptions,
    private callbacks: RealtimeVoiceCallbacks,
  ) {
    const model = options.model || DEFAULT_REALTIME_MODEL;
    this.ws = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
      { headers: { Authorization: `Bearer ${options.apiKey}` } },
    );

    this.ws.on("open", () => {
      if (this.closed) {
        this.ws.close();
        return;
      }
      this.configureSession();
    });

    this.ws.on("message", (raw) => {
      if (this.closed) return;
      try {
        this.handleEvent(JSON.parse(String(raw)));
      } catch (error) {
        logger.warn("Unparseable realtime event", error);
      }
    });

    this.ws.on("error", (error) => {
      if (this.closed) return;
      logger.error("Realtime socket error", error.message);
      this.callbacks.onError(
        "The realtime voice connection failed. Check the OpenAI API key in Settings → Providers.",
      );
    });

    this.ws.on("close", (code, reason) => {
      if (this.closed) return;
      const detail = reason?.toString().trim();
      logger.warn(
        `Realtime socket closed (${code}${detail ? `: ${detail}` : ""})`,
      );
      this.callbacks.onClosed(detail || `closed with code ${code}`);
    });
  }

  private configureSession(): void {
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: this.options.instructions,
        audio: {
          input: {
            format: { type: "audio/pcm", rate: REALTIME_SAMPLE_RATE },
            // Let the service decide when a turn ends; this is what makes
            // interruption and turn-taking reliable.
            turn_detection: { type: "semantic_vad" },
            transcription: {
              model: this.options.transcriptionModel || "gpt-live-transcribe",
            },
          },
          output: {
            format: { type: "audio/pcm", rate: REALTIME_SAMPLE_RATE },
            voice: this.options.voice || DEFAULT_REALTIME_VOICE,
          },
        },
      },
    });

    this.ready = true;
    for (const chunk of this.pending) this.appendAudio(chunk);
    this.pending = [];
    this.callbacks.onReady();
  }

  private handleEvent(event: Record<string, any>): void {
    const type = String(event.type ?? "");

    switch (type) {
      case "session.created":
      case "session.updated":
        break;

      case "input_audio_buffer.speech_started":
        this.callbacks.onSpeechStarted();
        break;

      case "input_audio_buffer.speech_stopped":
        this.callbacks.onSpeechStopped();
        break;

      // The user's own words, once transcribed.
      case "conversation.item.input_audio_transcription.completed":
      case "conversation.item.audio_transcription.completed": {
        const text = String(event.transcript ?? "").trim();
        if (text) this.callbacks.onUserTranscript(text);
        break;
      }

      // Assistant reply text, streamed alongside the audio.
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta": {
        const delta = String(event.delta ?? "");
        if (delta) {
          this.assistantText += delta;
          this.callbacks.onAssistantDelta(delta);
        }
        break;
      }

      // Assistant audio.
      case "response.output_audio.delta":
      case "response.audio.delta": {
        const audio = event.delta;
        if (typeof audio === "string" && audio.length > 0) {
          this.callbacks.onAudio(
            Buffer.from(audio, "base64"),
            REALTIME_SAMPLE_RATE,
          );
        }
        break;
      }

      case "response.done": {
        const text = this.assistantText.trim();
        this.assistantText = "";
        this.callbacks.onResponseDone(text);
        break;
      }

      case "error": {
        const message =
          event.error?.message ?? event.message ?? "Realtime error.";
        logger.error("Realtime API error", message);
        this.callbacks.onError(String(message));
        break;
      }

      default:
        break;
    }
  }

  sendAudio(pcm16: Buffer): void {
    if (this.closed) return;
    if (!this.ready) {
      // Small backlog so the first words survive the handshake.
      this.pending.push(pcm16);
      if (this.pending.length > 50) this.pending.shift();
      return;
    }
    this.appendAudio(pcm16);
  }

  private appendAudio(pcm16: Buffer): void {
    this.send({
      type: "input_audio_buffer.append",
      audio: pcm16.toString("base64"),
    });
  }

  /** Stop the assistant mid-sentence (barge-in or the stop button). */
  cancelResponse(): void {
    if (this.closed || !this.ready) return;
    this.assistantText = "";
    this.send({ type: "response.cancel" });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pending = [];
    try {
      this.ws.close();
    } catch {
      this.ws.terminate();
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(payload));
    } catch (error) {
      logger.warn("Realtime send failed", error);
    }
  }
}
