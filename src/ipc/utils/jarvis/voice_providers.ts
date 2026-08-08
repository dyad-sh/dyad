/**
 * Provider-agnostic interfaces for the JARVIS voice pipeline, plus mock
 * implementations used by tests and by mock sessions (no ElevenLabs credits).
 *
 * Keeping the wire protocols behind these interfaces lets ElevenLabs be
 * replaced or supplemented later (local Whisper, Apple Speech, OpenAI, …)
 * without touching the session orchestrator.
 */

export interface SttCallbacks {
  /** Operational status worth showing in the Activity timeline. */
  onStatus?: (status: {
    title: string;
    summary?: string;
    level: "info" | "warning";
  }) => void;
  /** Live partial transcript while the user is speaking. */
  onPartial: (text: string) => void;
  /** Final transcript for one utterance; triggers an LLM turn. */
  onCommitted: (text: string) => void;
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  onError: (message: string) => void;
}

export interface RealtimeSttSession {
  /** 16 kHz mono PCM16 audio. */
  sendAudio(pcm16: Buffer): void;
  /**
   * Hint from renderer-side voice activity detection. Providers with their
   * own server-side VAD may ignore these; the batch fallback uses them to
   * segment utterances.
   */
  notifySpeechActivity(kind: "start" | "end"): void;
  close(): void;
}

export interface TtsCallbacks {
  /** PCM16 mono audio ready for playback. */
  onAudio: (pcm16: Buffer, sampleRate: number) => void;
  /** All audio for the utterance has been emitted. */
  onDone: () => void;
  onError: (message: string) => void;
}

export interface StreamingTtsSession {
  /** Enqueue one natural phrase for synthesis. */
  speak(text: string): void;
  /** No more text is coming for this utterance. */
  finish(): void;
  /** Drop queued/unplayed speech immediately (interruption). */
  cancel(): void;
}

export type SttFactory = (
  callbacks: SttCallbacks,
) => Promise<RealtimeSttSession>;
export type TtsFactory = (
  callbacks: TtsCallbacks,
) => Promise<StreamingTtsSession>;

// =============================================================================
// Mocks
// =============================================================================

/**
 * Mock STT: segments audio purely on renderer VAD hints and commits a canned
 * transcript at each speech end. Tests can also drive callbacks directly.
 */
export class MockSttSession implements RealtimeSttSession {
  private receivedBytes = 0;

  constructor(
    private callbacks: SttCallbacks,
    private cannedTranscript = "",
  ) {}

  sendAudio(pcm16: Buffer): void {
    this.receivedBytes += pcm16.length;
  }

  notifySpeechActivity(kind: "start" | "end"): void {
    if (kind === "start") {
      this.callbacks.onSpeechStart();
      if (this.cannedTranscript) {
        this.callbacks.onPartial(this.cannedTranscript);
      }
    } else {
      this.callbacks.onSpeechEnd();
      if (this.cannedTranscript) {
        this.callbacks.onCommitted(this.cannedTranscript);
      }
    }
  }

  close(): void {}
}

/** Mock TTS: emits a short burst of silence per phrase, synchronously. */
export class MockTtsSession implements StreamingTtsSession {
  private cancelled = false;

  constructor(
    private callbacks: TtsCallbacks,
    private sampleRate = 24000,
  ) {}

  speak(text: string): void {
    if (this.cancelled || !text) return;
    // ~40ms of silence per 10 characters, capped at 400ms.
    const ms = Math.min(400, Math.max(40, text.length * 4));
    const samples = Math.floor((this.sampleRate * ms) / 1000);
    this.callbacks.onAudio(Buffer.alloc(samples * 2), this.sampleRate);
  }

  finish(): void {
    if (this.cancelled) return;
    this.callbacks.onDone();
  }

  cancel(): void {
    this.cancelled = true;
  }
}
