import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

const CHECKSUM_CHUNK_BYTES = 64 * 1024;

// Hash a file without materializing it in memory. pipeline() closes both
// streams on success or failure, which is important during early startup when
// a failed upgrade backup must not leave file descriptors behind.
export async function calculateFileChecksum(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const hashSink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        hash.update(chunk);
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });

  await pipeline(
    createReadStream(filePath, { highWaterMark: CHECKSUM_CHUNK_BYTES }),
    hashSink,
  );
  return hash.digest("hex");
}
