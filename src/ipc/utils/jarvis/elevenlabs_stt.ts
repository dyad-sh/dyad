import WebSocket from "ws";
import log from "electron-log";
import type { RealtimeSttSession, SttCallbacks } from "./voice_providers";

const logger = log.scope("jarvis-stt");

export interface ElevenLabsSttOptions {
  apiKey: string;
  /** Realtime model, e.g. "scribe_v2_realtime". */
  modelId: string;
  languageCode?: string;
  autoDetectLanguage?: boolean;
  /** 0..1 – forwarded as the server-side VAD threshold. */
  vadThreshold?: number;
  /** Silence duration that commits an utterance. */
  silenceTimeoutMs?: number;
}

const INPUT_SAMPLE_RATE = 16000;

/**
 * Realtime STT over the ElevenLabs `/v1/speech-to-text/realtime` WebSocket
 * (server-side VAD commit strategy). If the socket cannot be established,
 * the session degrades to batch mode: audio is buffered between the
 * renderer's speech start/end hints and transcribed with the batch
 * `/v1/speech-to-text` endpoint, so voice input keeps working.
 *
 * The API key is only ever used here, in the main process.
 */
export class ElevenLabsSttSession implements RealtimeSttSession {
  private ws: WebSocket | null = null;
  private wsReady = false;
  private closed = false;
  private batchMode = false;
  /** Log the first chunk only, so we can tell a dead mic from a quiet one. */
  private loggedFirstAudio = false;
  /** Periodic level reporting: distinguishes silence from real speech. */
  private levelWindowPeak = 0;
  private levelWindowStartedAt = 0;
  private batchBuffer: Buffer[] = [];
  private batchBufferedBytes = 0;
  private pendingChunks: Buffer[] = [];

  /** ~60s cap on a single batch utterance. */
  private static readonly MAX_BATCH_BYTES = INPUT_SAMPLE_RATE * 2 * 60;

  constructor(
    private options: ElevenLabsSttOptions,
    private callbacks: SttCallbacks,
  ) {
    this.connectRealtime();
  }

  private connectRealtime(): void {
    const params = new URLSearchParams({
      model_id: this.options.modelId,
      audio_format: `pcm_${INPUT_SAMPLE_RATE}`,
      commit_strategy: "vad",
    });
    if (this.options.languageCode && !this.options.autoDetectLanguage) {
      params.set("language_code", this.options.languageCode);
    }
    if (this.options.autoDetectLanguage) {
      params.set("include_language_detection", "true");
    }
    if (this.options.vadThreshold != null) {
      params.set("vad_threshold", String(this.options.vadThreshold));
    }
    if (this.options.silenceTimeoutMs != null) {
      params.set(
        "vad_silence_threshold_secs",
        String(this.options.silenceTimeoutMs / 1000),
      );
    }

    const ws = new WebSocket(
      `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params.toString()}`,
      { headers: { "xi-api-key": this.options.apiKey } },
    );
    this.ws = ws;

    ws.on("open", () => {
      if (this.closed) {
        ws.close();
        return;
      }
      this.wsReady = true;
      for (const chunk of this.pendingChunks) {
        this.sendRealtimeChunk(chunk);
      }
      this.pendingChunks = [];
    });

    ws.on("message", (raw) => {
      if (this.closed) return;
      try {
        this.handleRealtimeMessage(JSON.parse(String(raw)));
      } catch (error) {
        logger.warn("Unparseable STT message", error);
      }
    });

    ws.on("error", (error) => {
      // A socket we closed on purpose (session teardown, and in development
      // React StrictMode's mount/unmount cycle) errors mid-handshake. That is
      // not a provider problem, so it should not read as one.
      if (this.closed) return;
      logger.warn(
        `Realtime STT unavailable (${error.message}); falling back to batch transcription`,
      );
      this.enterBatchMode();
    });

    ws.on("close", (code, reason) => {
      this.wsReady = false;
      if (this.closed) return;
      if (!this.batchMode) {
        const detail = reason?.toString().trim();
        logger.warn(
          `Realtime STT socket closed (${code}${
            detail ? `: ${detail}` : ""
          }); using batch mode`,
        );
        this.enterBatchMode();
      }
    });
  }

  private handleRealtimeMessage(message: Record<string, unknown>): void {
    const type = String(message.message_type ?? "");
    const text = typeof message.text === "string" ? message.text : "";
    switch (type) {
      case "session_started":
        // Confirms the handshake and the negotiated config, which is what
        // distinguishes "plan does not include realtime" from a bad request.
        logger.info(
          `Realtime STT session started: ${JSON.stringify(message.config ?? {})}`,
        );
        break;
      case "partial_transcript":
        if (text.trim()) this.callbacks.onPartial(text);
        break;
      case "committed_transcript":
      case "committed_transcript_with_timestamps":
      case "final_transcript":
      case "final_transcript_with_timestamps":
        if (text.trim()) {
          logger.info(`Transcribed: "${text.trim().slice(0, 80)}"`);
          this.callbacks.onCommitted(text.trim());
        }
        break;
      case "insufficient_audio_activity":
        // Benign: silence between utterances.
        break;
      default:
        if (type.includes("error") || message.error) {
          const detail = String(message.error ?? type);
          if (type === "auth_error" || type === "quota_exceeded") {
            this.callbacks.onError(
              "ElevenLabs rejected the speech-to-text connection. Check the API key and plan in Settings → Voice Assistant.",
            );
            this.close();
          } else {
            logger.warn(`STT ${type}: ${detail}`);
          }
        }
    }
  }

  private enterBatchMode(): void {
    if (this.batchMode || this.closed) return;
    this.batchMode = true;
    this.callbacks.onStatus?.({
      title: "Using batch transcription",
      summary:
        "Real-time speech-to-text is unavailable, so speech is transcribed after each phrase.",
      level: "warning",
    });
    this.wsReady = false;
    this.pendingChunks = [];
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;
  }

  sendAudio(pcm16: Buffer): void {
    if (this.closed) return;
    if (!this.loggedFirstAudio) {
      this.loggedFirstAudio = true;
      this.levelWindowStartedAt = Date.now();
      logger.info(
        `Receiving microphone audio (${pcm16.length} bytes in the first chunk).`,
      );
    }
    this.trackInputLevel(pcm16);
    if (this.batchMode) {
      // Buffer unconditionally. Gating on a speech-start flag loses a whole
      // utterance whenever the realtime socket drops mid-speech, because the
      // start for that utterance arrived before batch mode existed.
      this.batchBuffer.push(pcm16);
      this.batchBufferedBytes += pcm16.length;
      // Rolling window: drop the oldest audio rather than the newest.
      while (
        this.batchBufferedBytes > ElevenLabsSttSession.MAX_BATCH_BYTES &&
        this.batchBuffer.length > 1
      ) {
        const dropped = this.batchBuffer.shift();
        this.batchBufferedBytes -= dropped?.length ?? 0;
      }
      return;
    }
    if (!this.wsReady) {
      // Keep a short pre-connection backlog so the first words aren't lost.
      this.pendingChunks.push(pcm16);
      if (this.pendingChunks.length > 50) this.pendingChunks.shift();
      return;
    }
    this.sendRealtimeChunk(pcm16);
  }

  private sendRealtimeChunk(pcm16: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(
        JSON.stringify({
          message_type: "input_audio_chunk",
          audio_base_64: pcm16.toString("base64"),
          sample_rate: INPUT_SAMPLE_RATE,
        }),
      );
    } catch (error) {
      logger.warn("STT send failed", error);
    }
  }

  notifySpeechActivity(kind: "start" | "end"): void {
    if (this.closed) return;
    if (kind === "start") {
      this.callbacks.onSpeechStart();
      if (this.batchMode) {
        // Start the utterance fresh, discarding the trailing silence that
        // accumulated since the last one.
        this.batchBuffer = [];
        this.batchBufferedBytes = 0;
      }
    } else {
      this.callbacks.onSpeechEnd();
      if (this.batchMode) {
        const audio = Buffer.concat(this.batchBuffer);
        this.batchBuffer = [];
        this.batchBufferedBytes = 0;
        // Skip blips shorter than ~300ms.
        if (audio.length > INPUT_SAMPLE_RATE * 2 * 0.3) {
          void this.transcribeBatch(audio);
        } else {
          logger.debug(
            `Ignoring ${audio.length} bytes of audio: shorter than the minimum utterance.`,
          );
        }
      }
    }
  }

  private async transcribeBatch(pcm16: Buffer): Promise<void> {
    try {
      const form = new FormData();
      form.append("model_id", "scribe_v1");
      if (this.options.languageCode && !this.options.autoDetectLanguage) {
        form.append("language_code", this.options.languageCode);
      }
      form.append(
        "file",
        new Blob(
          [new Uint8Array(encodeWavPcm16Mono(pcm16, INPUT_SAMPLE_RATE))],
          {
            type: "audio/wav",
          },
        ),
        "utterance.wav",
      );
      const response = await fetch(
        "https://api.elevenlabs.io/v1/speech-to-text",
        {
          method: "POST",
          headers: { "xi-api-key": this.options.apiKey },
          body: form,
        },
      );
      if (!response.ok) {
        const status = response.status;
        this.callbacks.onError(
          status === 401
            ? "ElevenLabs rejected the API key. Update it in Settings → Voice Assistant."
            : `Speech-to-text request failed (HTTP ${status}).`,
        );
        return;
      }
      const result = (await response.json()) as { text?: string };
      const text = result.text?.trim();
      if (this.closed) return;
      if (text) {
        this.callbacks.onCommitted(text);
      } else {
        this.callbacks.onStatus?.({
          title: "No speech recognised",
          summary: "The recording reached ElevenLabs but came back empty.",
          level: "warning",
        });
      }
    } catch (error) {
      logger.error("Batch transcription failed", error);
      if (!this.closed) {
        this.callbacks.onError(
          "Speech-to-text failed. Check the network connection and try again.",
        );
      }
    }
  }

  /**
   * Report the loudest sample seen every few seconds. A peak stuck near zero
   * means the capture device is silent (muted or wrong input), which is
   * otherwise indistinguishable from a transcriber that never responds.
   */
  private trackInputLevel(pcm16: Buffer): void {
    for (let offset = 0; offset + 1 < pcm16.length; offset += 2) {
      const sample = Math.abs(pcm16.readInt16LE(offset));
      if (sample > this.levelWindowPeak) this.levelWindowPeak = sample;
    }
    const elapsed = Date.now() - this.levelWindowStartedAt;
    if (elapsed < 5_000) return;
    const peak = this.levelWindowPeak / 32768;
    logger.info(
      `Microphone level over ${Math.round(elapsed / 1000)}s: peak ${peak.toFixed(3)}${
        peak < 0.01 ? " (silent — check the input device)" : ""
      }`,
    );
    this.levelWindowPeak = 0;
    this.levelWindowStartedAt = Date.now();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pendingChunks = [];
    this.batchBuffer = [];
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;
  }
}

/** Wrap raw 16-bit mono PCM in a minimal WAV container. */
export function encodeWavPcm16Mono(pcm16: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm16.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm16.length, 40);
  return Buffer.concat([header, pcm16]);
}
