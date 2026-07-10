// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildDyadMediaThumbnailUrl,
  buildDyadMediaUrl,
} from "../lib/dyadMediaUrl";
import {
  getMediaThumbnailCacheDirectory,
  MAX_MEDIA_THUMBNAIL_OUTPUT_BYTES,
  MAX_MEDIA_THUMBNAIL_SOURCE_BYTES,
} from "../ipc/utils/media_thumbnail";
import { createDyadMediaProtocolHandler } from "./dyad_media_protocol";

const IMAGE_FIXTURE_PATH = path.join(
  process.cwd(),
  "e2e-tests",
  "fixtures",
  "images",
  "logo.png",
);

describe("dyad-media thumbnail protocol", () => {
  let root: string;
  let appPath: string;
  let mediaPath: string;
  let cacheRoot: string;
  let pngData: Buffer;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-media-protocol-"));
    appPath = path.join(root, "app");
    mediaPath = path.join(appPath, ".dyad", "media");
    cacheRoot = path.join(root, "cache");
    await fs.mkdir(mediaPath, { recursive: true });
    pngData = await fs.readFile(IMAGE_FIXTURE_PATH);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function makeHandler({ output = pngData }: { output?: Buffer } = {}) {
    const fetchFile = vi.fn(async () => new Response("original"));
    const createThumbnailFromPath = vi.fn(async () => ({
      isEmpty: () => false,
      getSize: () => ({ width: 120, height: 120 }),
      toPNG: () => output,
    }));
    const handler = createDyadMediaProtocolHandler({
      cacheRoot,
      resolveAppPath: (value) => value,
      fetchFile,
      createThumbnailFromPath,
    });
    return { handler, fetchFile, createThumbnailFromPath };
  }

  async function writeImage(fileName = "image.png"): Promise<string> {
    const sourcePath = path.join(mediaPath, fileName);
    await fs.writeFile(sourcePath, pngData);
    return sourcePath;
  }

  it("serves originals only when a thumbnail was not requested", async () => {
    const sourcePath = await writeImage();
    const realSourcePath = await fs.realpath(sourcePath);
    const { handler, fetchFile, createThumbnailFromPath } = makeHandler();

    const result = await handler(
      new Request(buildDyadMediaUrl(appPath, "image.png")),
    );

    expect(result.status).toBe(200);
    expect(await result.text()).toBe("original");
    expect(fetchFile).toHaveBeenCalledWith(pathToFileURL(realSourcePath).href);
    expect(createThumbnailFromPath).not.toHaveBeenCalled();
  });

  it("creates a bounded derivative once and reuses its mtime-keyed cache", async () => {
    const sourcePath = await writeImage();
    const realSourcePath = await fs.realpath(sourcePath);
    const stat = await fs.stat(sourcePath);
    const { handler, createThumbnailFromPath } = makeHandler();
    const requestUrl = buildDyadMediaThumbnailUrl(
      appPath,
      "image.png",
      stat.mtimeMs,
      stat.size,
    );

    const first = await handler(new Request(requestUrl));
    const second = await handler(new Request(requestUrl));

    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("image/png");
    expect(first.headers.get("x-dyad-thumbnail-cache")).toBe("miss");
    expect(first.headers.get("cache-control")).toContain("immutable");
    expect(second.headers.get("x-dyad-thumbnail-cache")).toBe("hit");
    expect(createThumbnailFromPath).toHaveBeenCalledTimes(1);
    expect(createThumbnailFromPath).toHaveBeenCalledWith(realSourcePath, {
      width: 240,
      height: 240,
    });
  });

  it("invalidates a derivative when source mtime changes", async () => {
    const sourcePath = await writeImage();
    const { handler, createThumbnailFromPath } = makeHandler();
    const firstStat = await fs.stat(sourcePath);

    await handler(
      new Request(
        buildDyadMediaThumbnailUrl(
          appPath,
          "image.png",
          firstStat.mtimeMs,
          firstStat.size,
        ),
      ),
    );

    const changedAt = new Date(firstStat.mtimeMs + 5_000);
    await fs.utimes(sourcePath, changedAt, changedAt);
    const secondStat = await fs.stat(sourcePath);
    await handler(
      new Request(
        buildDyadMediaThumbnailUrl(
          appPath,
          "image.png",
          secondStat.mtimeMs,
          secondStat.size,
        ),
      ),
    );

    expect(createThumbnailFromPath).toHaveBeenCalledTimes(2);
    const cacheEntries = await fs.readdir(
      getMediaThumbnailCacheDirectory(cacheRoot, sourcePath),
    );
    expect(cacheEntries).toHaveLength(1);
  });

  it("rejects oversized image dimensions before native decoding", async () => {
    const oversizedPngHeader = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(oversizedPngHeader);
    oversizedPngHeader.write("IHDR", 12, "ascii");
    oversizedPngHeader.writeUInt32BE(10_001, 16);
    oversizedPngHeader.writeUInt32BE(2_000, 20);
    await fs.writeFile(
      path.join(mediaPath, "oversized.png"),
      oversizedPngHeader,
    );
    const { handler, createThumbnailFromPath } = makeHandler();

    const result = await handler(
      new Request(`${buildDyadMediaUrl(appPath, "oversized.png")}?thumbnail=1`),
    );

    expect(result.status).toBe(413);
    expect(createThumbnailFromPath).not.toHaveBeenCalled();
  });

  it("rejects oversized source files before reading or decoding them", async () => {
    const sourcePath = path.join(mediaPath, "too-large.png");
    const file = await fs.open(sourcePath, "w");
    await file.truncate(MAX_MEDIA_THUMBNAIL_SOURCE_BYTES + 1);
    await file.close();
    const { handler, createThumbnailFromPath } = makeHandler();

    const result = await handler(
      new Request(`${buildDyadMediaUrl(appPath, "too-large.png")}?thumbnail=1`),
    );

    expect(result.status).toBe(413);
    expect(createThumbnailFromPath).not.toHaveBeenCalled();
  });

  it("falls back safely for corrupt images and oversized output", async () => {
    await fs.writeFile(path.join(mediaPath, "corrupt.png"), "not an image");
    const corrupt = makeHandler();
    const corruptResult = await corrupt.handler(
      new Request(`${buildDyadMediaUrl(appPath, "corrupt.png")}?thumbnail=1`),
    );
    expect(corruptResult.status).toBe(415);
    expect(corrupt.createThumbnailFromPath).not.toHaveBeenCalled();

    await writeImage("large-output.png");
    const largeOutput = Buffer.alloc(MAX_MEDIA_THUMBNAIL_OUTPUT_BYTES + 1);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(largeOutput);
    const oversizedOutput = makeHandler({ output: largeOutput });
    const outputResult = await oversizedOutput.handler(
      new Request(
        `${buildDyadMediaUrl(appPath, "large-output.png")}?thumbnail=1`,
      ),
    );
    expect(outputResult.status).toBe(413);
  });

  it("rejects symlinks that escape the media directory", async () => {
    const outsidePath = path.join(root, "outside.png");
    await fs.writeFile(outsidePath, pngData);
    await fs.symlink(outsidePath, path.join(mediaPath, "escape.png"));
    const { handler, fetchFile, createThumbnailFromPath } = makeHandler();

    const result = await handler(
      new Request(`${buildDyadMediaUrl(appPath, "escape.png")}?thumbnail=1`),
    );

    expect(result.status).toBe(403);
    expect(fetchFile).not.toHaveBeenCalled();
    expect(createThumbnailFromPath).not.toHaveBeenCalled();
  });
});
