/**
 * Caps how much of a child process's output is copied into main.log.
 *
 * electron-log writes its file transport synchronously on the main thread,
 * so a dev server stuck printing errors in a loop turns every output chunk
 * into a blocking file append. The limiter admits a bounded number of chunks
 * per window, truncates long chunks, and reports what it suppressed once the
 * next window starts or the process exits. It only governs logging: the
 * renderer and the app log store still receive every chunk.
 */

const DEFAULT_WINDOW_MS = 10_000;
const DEFAULT_MAX_CHUNKS_PER_WINDOW = 50;
const DEFAULT_MAX_CHUNK_CHARS = 4096;

export interface ProcessOutputLogLimiterOptions {
  windowMs?: number;
  maxChunksPerWindow?: number;
  maxChunkChars?: number;
  now?: () => number;
}

export interface AdmittedOutputLog {
  message: string;
  // Set on the first admitted chunk after chunks were suppressed.
  suppressedNote: string | null;
}

export class ProcessOutputLogLimiter {
  private readonly windowMs: number;
  private readonly maxChunksPerWindow: number;
  private readonly maxChunkChars: number;
  private readonly now: () => number;
  private windowStart = Number.NEGATIVE_INFINITY;
  private admittedInWindow = 0;
  private suppressedChunks = 0;
  private suppressedChars = 0;

  constructor(options: ProcessOutputLogLimiterOptions = {}) {
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxChunksPerWindow =
      options.maxChunksPerWindow ?? DEFAULT_MAX_CHUNKS_PER_WINDOW;
    this.maxChunkChars = options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Returns what to log for this chunk, or null when it should be skipped.
   */
  admit(message: string): AdmittedOutputLog | null {
    const now = this.now();
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.admittedInWindow = 0;
    }
    if (this.admittedInWindow >= this.maxChunksPerWindow) {
      this.suppressedChunks++;
      this.suppressedChars += message.length;
      return null;
    }
    this.admittedInWindow++;
    return {
      message: this.truncate(message),
      suppressedNote: this.takeSuppressedNote(),
    };
  }

  /**
   * Reports chunks suppressed since the last admitted one, if any. Call when
   * the process exits so a final burst is not silently lost.
   */
  takeSuppressedNote(): string | null {
    if (this.suppressedChunks === 0) {
      return null;
    }
    const note = `suppressed ${this.suppressedChunks} output chunk(s) (${this.suppressedChars} chars) from the log`;
    this.suppressedChunks = 0;
    this.suppressedChars = 0;
    return note;
  }

  private truncate(message: string): string {
    if (message.length <= this.maxChunkChars) {
      return message;
    }
    const omitted = message.length - this.maxChunkChars;
    return `${message.slice(0, this.maxChunkChars)}… [${omitted} more chars truncated]`;
  }
}
