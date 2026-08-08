import WebSocket from "ws";
import log from "electron-log";
import type { StreamingTtsSession, TtsCallbacks } from "./voice_providers";

const logger = log.scope("jarvis-tts");

export interface ElevenLabsTtsOptions {
  apiKey: string;
  voiceId: string;
  modelId: string;
  /** e.g. "pcm_24000" — PCM is required so the renderer can stream-play it. */
  outputFormat: string;
  stability?: number;
  similarityBoost?: number;
  speed?: number;
  streamingLatency?: number;
}

export function sampleRateFromOutputFormat(outputFormat: string): number {
  const match = /pcm_(\d+)/.exec(outputFormat);
  return match ? Number(match[1]) : 24000;
}

/**
 * Streaming TTS over the ElevenLabs `stream-input` WebSocket.
 * One session per assistant utterance: phrases are pushed as they leave the
 * sentence buffer, audio chunks stream back, `cancel()` tears the socket
 * down mid-utterance for barge-in.
 *
 * The API key is only ever used here, in the main process.
 */
export class ElevenLabsTtsSession implements StreamingTtsSession {
  private ws: WebSocket;
  private open = false;
  private cancelled = false;
  private finished = false;
  private queue: string[] = [];
  private readonly sampleRate: number;

  constructor(
    private options: ElevenLabsTtsOptions,
    private callbacks: TtsCallbacks,
  ) {
    this.sampleRate = sampleRateFromOutputFormat(options.outputFormat);
    const params = new URLSearchParams({
      model_id: options.modelId,
      output_format: options.outputFormat,
    });
    if (options.streamingLatency != null) {
      params.set(
        "optimize_streaming_latency",
        String(options.streamingLatency),
      );
    }
    const url = `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
      options.voiceId,
    )}/stream-input?${params.toString()}`;

    this.ws = new WebSocket(url, {
      headers: { "xi-api-key": options.apiKey },
    });

    this.ws.on("open", () => {
      if (this.cancelled) {
        this.ws.close();
        return;
      }
      this.open = true;
      const voiceSettings: Record<string, number> = {};
      if (options.stability != null)
        voiceSettings.stability = options.stability;
      if (options.similarityBoost != null) {
        voiceSettings.similarity_boost = options.similarityBoost;
      }
      if (options.speed != null) voiceSettings.speed = options.speed;
      this.send({
        text: " ",
        ...(Object.keys(voiceSettings).length > 0
          ? { voice_settings: voiceSettings }
          : {}),
      });
      for (const text of this.queue) {
        this.sendPhrase(text);
      }
      this.queue = [];
      if (this.finished) {
        this.send({ text: "" });
      }
    });

    this.ws.on("message", (raw) => {
      if (this.cancelled) return;
      try {
        const message = JSON.parse(String(raw));
        if (typeof message.audio === "string" && message.audio.length > 0) {
          this.callbacks.onAudio(
            Buffer.from(message.audio, "base64"),
            this.sampleRate,
          );
        }
        if (message.isFinal === true) {
          this.callbacks.onDone();
        }
        if (message.error) {
          this.callbacks.onError(String(message.message ?? message.error));
        }
      } catch (error) {
        logger.warn("Unparseable TTS message", error);
      }
    });

    this.ws.on("error", (error) => {
      if (this.cancelled) return;
      logger.error("TTS websocket error", error.message);
      this.callbacks.onError(
        "Voice output connection failed. Check the ElevenLabs API key and voice in Settings → Voice Assistant.",
      );
    });

    this.ws.on("close", () => {
      // The service closes the socket after the final chunk. If we never got
      // an isFinal marker, still resolve the utterance so the session can
      // return to listening.
      if (!this.cancelled && this.finished) {
        this.callbacks.onDone();
      }
    });
  }

  speak(text: string): void {
    if (this.cancelled || this.finished) return;
    if (!this.open) {
      this.queue.push(text);
      return;
    }
    this.sendPhrase(text);
  }

  finish(): void {
    if (this.cancelled || this.finished) return;
    this.finished = true;
    if (this.open) {
      this.send({ text: "" });
    }
    // If not yet open, the open handler sends the terminator.
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.queue = [];
    try {
      this.ws.close();
    } catch {
      this.ws.terminate();
    }
  }

  private sendPhrase(text: string): void {
    // Trailing space is required by stream-input for proper chunk merging.
    this.send({ text: `${text} `, try_trigger_generation: true });
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(payload));
    } catch (error) {
      logger.warn("TTS send failed", error);
    }
  }
}
