export const DEFAULT_MAX_BUFFERED_OUTPUT_BYTES = 256_000;
export const OUTPUT_TRUNCATION_MARKER = "[... earlier output truncated ...]\n";

/**
 * Retains only the newest bytes from a stream in a fixed-size ring until the
 * output is decoded. Keeping bytes (instead of repeatedly concatenating
 * strings) avoids quadratic copies and correctly reconstructs UTF-8
 * characters split across process-output chunks.
 */
export class BoundedOutputBuffer {
  private storage: Buffer | undefined;
  private writeOffset = 0;
  private retainedByteLength = 0;
  private truncated = false;

  constructor(private readonly maxBytes = DEFAULT_MAX_BUFFERED_OUTPUT_BYTES) {
    if (!Number.isInteger(maxBytes) || maxBytes < 0) {
      throw new RangeError("maxBytes must be a non-negative integer");
    }
  }

  append(chunk: string | Buffer): void {
    if (chunk.length === 0) {
      return;
    }

    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;

    if (this.maxBytes === 0) {
      this.retainedByteLength = 0;
      this.truncated = true;
      return;
    }

    this.storage ??= Buffer.allocUnsafe(this.maxBytes);

    if (bytes.byteLength >= this.maxBytes) {
      const discardedPreviousOutput = this.retainedByteLength > 0;
      bytes.copy(this.storage, 0, bytes.byteLength - this.maxBytes);
      this.writeOffset = 0;
      this.retainedByteLength = this.maxBytes;
      this.truncated ||=
        bytes.byteLength > this.maxBytes || discardedPreviousOutput;
      return;
    }

    const bytesUntilEnd = this.maxBytes - this.writeOffset;
    const firstCopyByteLength = Math.min(bytes.byteLength, bytesUntilEnd);
    bytes.copy(this.storage, this.writeOffset, 0, firstCopyByteLength);
    if (firstCopyByteLength < bytes.byteLength) {
      bytes.copy(this.storage, 0, firstCopyByteLength);
    }

    this.writeOffset = (this.writeOffset + bytes.byteLength) % this.maxBytes;
    this.retainedByteLength += bytes.byteLength;
    if (this.retainedByteLength > this.maxBytes) {
      this.retainedByteLength = this.maxBytes;
      this.truncated = true;
    }
  }

  get byteLength(): number {
    return this.retainedByteLength;
  }

  get wasTruncated(): boolean {
    return this.truncated;
  }

  clear(): void {
    this.storage = undefined;
    this.writeOffset = 0;
    this.retainedByteLength = 0;
    this.truncated = false;
  }

  toString(): string {
    if (this.retainedByteLength === 0) {
      return this.truncated ? OUTPUT_TRUNCATION_MARKER.trimEnd() : "";
    }

    if (!this.storage) {
      return this.truncated ? OUTPUT_TRUNCATION_MARKER.trimEnd() : "";
    }

    let retainedBytes: Buffer;
    if (this.retainedByteLength < this.maxBytes) {
      retainedBytes = this.storage.subarray(0, this.retainedByteLength);
    } else if (this.writeOffset === 0) {
      retainedBytes = this.storage;
    } else {
      retainedBytes = Buffer.allocUnsafe(this.retainedByteLength);
      const endByteLength = this.maxBytes - this.writeOffset;
      this.storage.copy(retainedBytes, 0, this.writeOffset, this.maxBytes);
      this.storage.copy(retainedBytes, endByteLength, 0, this.writeOffset);
    }

    // If eviction bisected a multi-byte UTF-8 character, discard the leading
    // continuation bytes rather than returning a replacement character.
    let start = 0;
    if (this.truncated) {
      while (
        start < retainedBytes.byteLength &&
        (retainedBytes[start] & 0xc0) === 0x80
      ) {
        start += 1;
      }
    }

    const output = retainedBytes.subarray(start).toString("utf8");
    return this.truncated ? OUTPUT_TRUNCATION_MARKER + output : output;
  }
}
