/**
 * Streaming sentence buffer.
 *
 * Accumulates LLM text deltas and flushes speakable chunks to TTS at natural
 * phrase boundaries so playback can start before the full answer exists.
 * Guarantees:
 *  - never emits a chunk that ends mid-word
 *  - prefers punctuation boundaries, falls back to whitespace once the
 *    buffer exceeds `maxBufferLength`
 *  - `cancel()` drops everything queued (used on interruption)
 */

export interface SentenceBufferOptions {
  /** Do not flush punctuation-terminated chunks shorter than this. */
  minFlushLength?: number;
  /** Force a whitespace-boundary flush once the buffer grows past this. */
  maxBufferLength?: number;
  onFlush: (text: string) => void;
}

const SENTENCE_END = /[.!?…。！？]/;

export class StreamingSentenceBuffer {
  private buffer = "";
  private readonly minFlushLength: number;
  private readonly maxBufferLength: number;
  private readonly onFlush: (text: string) => void;
  private cancelled = false;

  constructor(options: SentenceBufferOptions) {
    this.minFlushLength = options.minFlushLength ?? 8;
    this.maxBufferLength = options.maxBufferLength ?? 220;
    this.onFlush = options.onFlush;
  }

  push(delta: string): void {
    if (this.cancelled || !delta) return;
    this.buffer += delta;
    this.drain();
  }

  /** Flush whatever remains (end of the LLM stream). */
  finish(): void {
    if (this.cancelled) return;
    const remainder = this.buffer.trim();
    this.buffer = "";
    if (remainder) {
      this.onFlush(remainder);
    }
  }

  /** Drop all buffered text without emitting (interruption). */
  cancel(): void {
    this.cancelled = true;
    this.buffer = "";
  }

  get pending(): string {
    return this.buffer;
  }

  private drain(): void {
    // Emit every complete sentence currently in the buffer.
    for (;;) {
      const cut = this.findSentenceCut();
      if (cut === -1) break;
      const chunk = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);
      if (chunk.length > 0) {
        this.onFlush(chunk);
      }
    }

    // Oversized buffer with no sentence boundary: flush at the last
    // whitespace so we never split a word.
    if (this.buffer.length > this.maxBufferLength) {
      const lastSpace = this.buffer.lastIndexOf(" ");
      if (lastSpace > 0) {
        const chunk = this.buffer.slice(0, lastSpace).trim();
        this.buffer = this.buffer.slice(lastSpace + 1);
        if (chunk.length > 0) {
          this.onFlush(chunk);
        }
      }
    }
  }

  /**
   * Index just past a sentence boundary that is safe to cut at, or -1.
   * A boundary is a sentence-ending character followed by whitespace —
   * requiring the following whitespace avoids cutting "3.5" or a stream
   * that paused right after a period that may be part of "e.g.".
   */
  private findSentenceCut(): number {
    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (!SENTENCE_END.test(this.buffer[i])) continue;
      // Consume trailing quotes/brackets after the punctuation.
      let end = i + 1;
      while (end < this.buffer.length && /["')\]”’]/.test(this.buffer[end])) {
        end++;
      }
      if (end >= this.buffer.length) return -1;
      if (!/\s/.test(this.buffer[end])) continue;
      if (end < this.minFlushLength) continue;
      return end;
    }
    return -1;
  }
}
