import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const MEDIA_THUMBNAIL_SIZE = 240;
export const MAX_MEDIA_THUMBNAIL_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_MEDIA_THUMBNAIL_SOURCE_PIXELS = 20_000_000;
export const MAX_MEDIA_THUMBNAIL_SOURCE_DIMENSION = 10_000;
export const MAX_MEDIA_THUMBNAIL_OUTPUT_BYTES = 1024 * 1024;

// JPEG metadata (EXIF, ICC, XMP, and embedded previews) can place the first
// start-of-frame marker well beyond a small header window.
const MAX_IMAGE_HEADER_BYTES = 4 * 1024 * 1024;
const SNAPSHOT_COPY_BUFFER_BYTES = 64 * 1024;
const MEDIA_THUMBNAIL_CACHE_VERSION = "v1";
const MAX_QUEUED_THUMBNAILS = 64;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface ThumbnailImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  toPNG(): Buffer;
}

interface ResizableThumbnailImage extends ThumbnailImage {
  resize(options: {
    width?: number;
    height?: number;
    quality?: "good" | "better" | "best";
  }): ThumbnailImage;
}

interface NativeImageThumbnailApi {
  createThumbnailFromPath: CreateThumbnailFromPath;
  createFromPath(sourcePath: string): ResizableThumbnailImage;
}

export type CreateThumbnailFromPath = (
  sourcePath: string,
  size: { width: number; height: number },
) => Promise<ThumbnailImage>;

export async function createPlatformThumbnailFromPath(
  nativeImageApi: NativeImageThumbnailApi,
  sourcePath: string,
  size: { width: number; height: number },
  platform: NodeJS.Platform = process.platform,
): Promise<ThumbnailImage> {
  if (platform !== "linux") {
    return nativeImageApi.createThumbnailFromPath(sourcePath, size);
  }

  // Electron does not implement createThumbnailFromPath on Linux. The source
  // dimensions are validated before this callback runs, so the fallback decode
  // remains bounded by MAX_MEDIA_THUMBNAIL_SOURCE_PIXELS.
  const image = nativeImageApi.createFromPath(sourcePath);
  if (image.isEmpty()) return image;

  const sourceSize = image.getSize();
  if (sourceSize.width <= size.width && sourceSize.height <= size.height) {
    return image;
  }

  return image.resize(
    sourceSize.width >= sourceSize.height
      ? { width: size.width, quality: "good" }
      : { height: size.height, quality: "good" },
  );
}

export class MediaThumbnailError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MediaThumbnailError";
  }
}

type ImageDimensions = { width: number; height: number };

function parsePngDimensions(header: Buffer): ImageDimensions | null {
  if (
    header.length < 24 ||
    !header.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    header.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return null;
  }

  return {
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20),
  };
}

function parseGifDimensions(header: Buffer): ImageDimensions | null {
  if (header.length < 10) return null;
  const signature = header.toString("ascii", 0, 6);
  if (signature !== "GIF87a" && signature !== "GIF89a") return null;

  return {
    width: header.readUInt16LE(6),
    height: header.readUInt16LE(8),
  };
}

function parseJpegDimensions(header: Buffer): ImageDimensions | null {
  if (header.length < 4 || header[0] !== 0xff || header[1] !== 0xd8) {
    return null;
  }

  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;

  while (offset + 3 < header.length) {
    while (offset < header.length && header[offset] !== 0xff) offset += 1;
    while (offset < header.length && header[offset] === 0xff) offset += 1;
    if (offset >= header.length) return null;

    const marker = header[offset];
    offset += 1;

    // Standalone markers do not carry a segment length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    if (offset + 2 > header.length) return null;

    const segmentLength = header.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > header.length) {
      return null;
    }

    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) return null;
      return {
        width: header.readUInt16BE(offset + 5),
        height: header.readUInt16BE(offset + 3),
      };
    }

    // Start-of-scan means no later dimension marker can be read safely.
    if (marker === 0xda) return null;
    offset += segmentLength;
  }

  return null;
}

function parseWebpDimensions(header: Buffer): ImageDimensions | null {
  if (
    header.length < 30 ||
    header.toString("ascii", 0, 4) !== "RIFF" ||
    header.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }

  const chunkType = header.toString("ascii", 12, 16);
  if (chunkType === "VP8X") {
    return {
      width: 1 + header.readUIntLE(24, 3),
      height: 1 + header.readUIntLE(27, 3),
    };
  }

  if (
    chunkType === "VP8 " &&
    header[23] === 0x9d &&
    header[24] === 0x01 &&
    header[25] === 0x2a
  ) {
    return {
      width: header.readUInt16LE(26) & 0x3fff,
      height: header.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunkType === "VP8L" && header[20] === 0x2f) {
    return {
      width: 1 + header[21] + ((header[22] & 0x3f) << 8),
      height:
        1 +
        ((header[22] & 0xc0) >> 6) +
        (header[23] << 2) +
        ((header[24] & 0x0f) << 10),
    };
  }

  return null;
}

export function parseImageDimensions(header: Buffer): ImageDimensions | null {
  return (
    parsePngDimensions(header) ??
    parseGifDimensions(header) ??
    parseJpegDimensions(header) ??
    parseWebpDimensions(header)
  );
}

async function readAndValidateImageDimensions(
  sourcePath: string,
  sourceBytes: number,
): Promise<ImageDimensions> {
  const file = await fs.open(sourcePath, "r");
  try {
    const header = Buffer.alloc(Math.min(sourceBytes, MAX_IMAGE_HEADER_BYTES));
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    const dimensions = parseImageDimensions(header.subarray(0, bytesRead));
    if (!dimensions) {
      throw new MediaThumbnailError("Unsupported or corrupt image", 415);
    }

    const { width, height } = dimensions;
    if (
      width <= 0 ||
      height <= 0 ||
      width > MAX_MEDIA_THUMBNAIL_SOURCE_DIMENSION ||
      height > MAX_MEDIA_THUMBNAIL_SOURCE_DIMENSION ||
      width > Math.floor(MAX_MEDIA_THUMBNAIL_SOURCE_PIXELS / height)
    ) {
      throw new MediaThumbnailError("Image dimensions are too large", 413);
    }

    return dimensions;
  } finally {
    await file.close();
  }
}

async function createBoundedSourceSnapshot(
  sourcePath: string,
  snapshotPath: string,
): Promise<number> {
  const source = await fs.open(sourcePath, "r");
  let destination: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const initialStat = await source.stat();
    if (!initialStat.isFile()) {
      throw new MediaThumbnailError("Image not found", 404);
    }
    if (initialStat.size <= 0) {
      throw new MediaThumbnailError("Image file is empty", 400);
    }
    if (initialStat.size > MAX_MEDIA_THUMBNAIL_SOURCE_BYTES) {
      throw new MediaThumbnailError("Image file is too large", 413);
    }

    destination = await fs.open(snapshotPath, "wx", 0o600);
    const buffer = Buffer.alloc(SNAPSHOT_COPY_BUFFER_BYTES);
    let snapshotBytes = 0;

    while (snapshotBytes <= MAX_MEDIA_THUMBNAIL_SOURCE_BYTES) {
      const bytesAllowed = MAX_MEDIA_THUMBNAIL_SOURCE_BYTES + 1 - snapshotBytes;
      const { bytesRead } = await source.read(
        buffer,
        0,
        Math.min(buffer.length, bytesAllowed),
        null,
      );
      if (bytesRead === 0) break;

      let bytesWritten = 0;
      while (bytesWritten < bytesRead) {
        const result = await destination.write(
          buffer,
          bytesWritten,
          bytesRead - bytesWritten,
          null,
        );
        if (result.bytesWritten === 0) {
          throw new Error("Could not write image snapshot");
        }
        bytesWritten += result.bytesWritten;
      }
      snapshotBytes += bytesRead;
    }

    if (snapshotBytes <= 0) {
      throw new MediaThumbnailError("Image file is empty", 400);
    }
    if (snapshotBytes > MAX_MEDIA_THUMBNAIL_SOURCE_BYTES) {
      throw new MediaThumbnailError("Image file is too large", 413);
    }
    return snapshotBytes;
  } finally {
    await Promise.allSettled([source.close(), destination?.close()]);
  }
}

export function getMediaThumbnailCacheRoot(cachePath: string): string {
  return path.join(
    cachePath,
    "dyad-media-thumbnails",
    MEDIA_THUMBNAIL_CACHE_VERSION,
  );
}

function sourceCacheDirectory(cacheRoot: string, sourcePath: string): string {
  const sourceKey = crypto
    .createHash("sha256")
    .update(path.resolve(sourcePath))
    .digest("hex");
  return path.join(cacheRoot, sourceKey);
}

export function getMediaThumbnailCacheDirectory(
  cacheRoot: string,
  sourcePath: string,
): string {
  return sourceCacheDirectory(cacheRoot, sourcePath);
}

export async function invalidateMediaThumbnailCache(
  cacheRoot: string,
  sourcePath: string,
): Promise<void> {
  await fs.rm(sourceCacheDirectory(cacheRoot, sourcePath), {
    recursive: true,
    force: true,
  });
}

function cacheFilePath(
  cacheRoot: string,
  sourcePath: string,
  sourceVersion: string,
): string {
  const versionKey = crypto
    .createHash("sha256")
    .update(sourceVersion)
    .digest("hex");
  return path.join(
    sourceCacheDirectory(cacheRoot, sourcePath),
    `${versionKey}.png`,
  );
}

async function readCachedThumbnail(cachePath: string): Promise<Buffer | null> {
  try {
    const stat = await fs.stat(cachePath);
    if (!stat.isFile() || stat.size > MAX_MEDIA_THUMBNAIL_OUTPUT_BYTES) {
      await fs.rm(cachePath, { force: true });
      return null;
    }

    const data = await fs.readFile(cachePath);
    if (!data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      await fs.rm(cachePath, { force: true });
      return null;
    }
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeCachedThumbnail(
  destinationPath: string,
  data: Buffer,
): Promise<void> {
  const directory = path.dirname(destinationPath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = `${destinationPath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;

  try {
    await fs.writeFile(temporaryPath, data, { flag: "wx" });
    await fs.rename(temporaryPath, destinationPath);

    // A source path only needs its current mtime-keyed derivative.
    const entries = await fs.readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            path.join(directory, entry.name) !== destinationPath &&
            !entry.name.endsWith(".tmp"),
        )
        .map((entry) =>
          fs.rm(path.join(directory, entry.name), { force: true }),
        ),
    );
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

class ThumbnailLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly concurrency: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      if (this.waiters.length >= MAX_QUEUED_THUMBNAILS) {
        throw new MediaThumbnailError("Thumbnail service is busy", 429);
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }

    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

export function createMediaThumbnailService({
  cacheRoot,
  createThumbnailFromPath,
}: {
  cacheRoot: string;
  createThumbnailFromPath: CreateThumbnailFromPath;
}) {
  // Native image decoding can briefly allocate several bytes per source pixel.
  // Serialize cache misses so multiple large photos cannot spike the main heap.
  const limiter = new ThumbnailLimiter(1);
  const inFlight = new Map<string, Promise<Buffer>>();

  const generateThumbnail = async (
    sourcePath: string,
    sourceVersion: string,
    destinationPath: string,
  ): Promise<Buffer> => {
    const directory = path.dirname(destinationPath);
    await fs.mkdir(directory, { recursive: true });
    const sourceExtension = path.extname(sourcePath);
    const snapshotPath = `${destinationPath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.source${sourceExtension}`;

    let output: Buffer;
    try {
      // Decode a private snapshot so a mutable source path cannot be replaced
      // with an oversized file after validation but before native decoding.
      const snapshotBytes = await createBoundedSourceSnapshot(
        sourcePath,
        snapshotPath,
      );
      await readAndValidateImageDimensions(snapshotPath, snapshotBytes);

      let image: ThumbnailImage;
      try {
        image = await createThumbnailFromPath(snapshotPath, {
          width: MEDIA_THUMBNAIL_SIZE,
          height: MEDIA_THUMBNAIL_SIZE,
        });
      } catch {
        throw new MediaThumbnailError("Could not create image thumbnail", 415);
      }

      const outputSize = image.getSize();
      if (
        image.isEmpty() ||
        outputSize.width <= 0 ||
        outputSize.height <= 0 ||
        outputSize.width > MEDIA_THUMBNAIL_SIZE ||
        outputSize.height > MEDIA_THUMBNAIL_SIZE ||
        outputSize.width * outputSize.height >
          MEDIA_THUMBNAIL_SIZE * MEDIA_THUMBNAIL_SIZE
      ) {
        throw new MediaThumbnailError("Invalid thumbnail output", 415);
      }

      output = image.toPNG();
      if (
        output.length === 0 ||
        !output.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
      ) {
        throw new MediaThumbnailError("Invalid thumbnail output format", 415);
      }
      if (output.length > MAX_MEDIA_THUMBNAIL_OUTPUT_BYTES) {
        throw new MediaThumbnailError("Thumbnail output is too large", 413);
      }
    } finally {
      await fs.rm(snapshotPath, { force: true });
    }

    const currentStat = await fs.stat(sourcePath);
    const currentVersion = `${currentStat.mtimeMs}:${currentStat.size}`;
    if (currentVersion !== sourceVersion) {
      throw new MediaThumbnailError(
        "Image changed while creating thumbnail",
        409,
      );
    }

    await writeCachedThumbnail(destinationPath, output);
    return output;
  };

  return {
    async getOrCreate(
      sourcePath: string,
      cacheKeyPath = sourcePath,
    ): Promise<{
      data: Buffer;
      sourceVersion: string;
      cacheHit: boolean;
    }> {
      const stat = await fs.stat(sourcePath);
      if (!stat.isFile()) {
        throw new MediaThumbnailError("Image not found", 404);
      }
      if (stat.size <= 0) {
        throw new MediaThumbnailError("Image file is empty", 400);
      }
      if (stat.size > MAX_MEDIA_THUMBNAIL_SOURCE_BYTES) {
        throw new MediaThumbnailError("Image file is too large", 413);
      }

      const sourceVersion = `${stat.mtimeMs}:${stat.size}`;
      const destinationPath = cacheFilePath(
        cacheRoot,
        cacheKeyPath,
        sourceVersion,
      );
      const cached = await readCachedThumbnail(destinationPath);
      if (cached) {
        return { data: cached, sourceVersion, cacheHit: true };
      }

      const existing = inFlight.get(destinationPath);
      if (existing) {
        return {
          data: await existing,
          sourceVersion,
          cacheHit: false,
        };
      }

      const pending = limiter.run(() =>
        generateThumbnail(sourcePath, sourceVersion, destinationPath),
      );
      inFlight.set(destinationPath, pending);

      try {
        return {
          data: await pending,
          sourceVersion,
          cacheHit: false,
        };
      } finally {
        inFlight.delete(destinationPath);
      }
    },
  };
}
