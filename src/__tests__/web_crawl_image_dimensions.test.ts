import { describe, expect, it } from "vitest";
import {
  getWebCrawlImageDimensions,
  getWebCrawlScreenshotOmissionReason,
} from "@/pro/main/ipc/handlers/local_agent/tools/web_crawl";

function makePngDataUrl(width: number, height: number): string {
  const buffer = Buffer.alloc(33);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i += 1) {
    buffer[i] = signature[i];
  }
  buffer.writeUInt32BE(13, 8);
  buffer.writeUInt32BE(0x49484452, 12);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function makeJpegDataUrl(width: number, height: number): string {
  // Minimal JPEG: SOI + SOF0 marker with dimensions
  const buffer = Buffer.alloc(15);
  // SOI marker
  buffer.writeUInt16BE(0xffd8, 0);
  // SOF0 marker
  buffer[2] = 0xff;
  buffer[3] = 0xc0;
  // Segment length (11 bytes)
  buffer.writeUInt16BE(11, 4);
  // Precision
  buffer[6] = 8;
  // Height and width
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

function makeGifDataUrl(width: number, height: number): string {
  const buffer = Buffer.alloc(10);
  buffer.write("GIF89a", 0, "ascii");
  buffer.writeUInt16LE(width, 6);
  buffer.writeUInt16LE(height, 8);
  return `data:image/gif;base64,${buffer.toString("base64")}`;
}

function makeWebpVP8XDataUrl(width: number, height: number): string {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(22, 4); // file size - 8
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUInt32LE(10, 16); // chunk size
  buffer.writeUInt32LE(0, 20); // flags
  // Width - 1 (24-bit LE)
  const w = width - 1;
  buffer[24] = w & 0xff;
  buffer[25] = (w >> 8) & 0xff;
  buffer[26] = (w >> 16) & 0xff;
  // Height - 1 (24-bit LE)
  const h = height - 1;
  buffer[27] = h & 0xff;
  buffer[28] = (h >> 8) & 0xff;
  buffer[29] = (h >> 16) & 0xff;
  return `data:image/webp;base64,${buffer.toString("base64")}`;
}

function makeWebpVP8DataUrl(width: number, height: number): string {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(22, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8 ", 12, "ascii");
  buffer.writeUInt32LE(10, 16); // chunk size
  // VP8 frame header: 3 bytes frame tag + 3 bytes sync code + dimensions
  buffer[20] = 0x9d;
  buffer[21] = 0x01;
  buffer[22] = 0x2a;
  // Padding bytes for sync
  buffer[23] = 0x00;
  buffer[24] = 0x00;
  buffer[25] = 0x00;
  // Width at offset 26 (LE, lower 14 bits)
  buffer.writeUInt16LE(width & 0x3fff, 26);
  // Height at offset 28 (LE, lower 14 bits)
  buffer.writeUInt16LE(height & 0x3fff, 28);
  return `data:image/webp;base64,${buffer.toString("base64")}`;
}

function makeWebpVP8LDataUrl(width: number, height: number): string {
  const buffer = Buffer.alloc(25);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(17, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8L", 12, "ascii");
  buffer.writeUInt32LE(5, 16); // chunk size
  // Signature byte
  buffer[20] = 0x2f;
  // Pack width-1 (14 bits) and height-1 (14 bits) into 32 bits LE
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  buffer.writeUInt32LE(bits, 21);
  return `data:image/webp;base64,${buffer.toString("base64")}`;
}

describe("web_crawl screenshot dimension checks", () => {
  it("returns null omission reason for supported screenshots", () => {
    const screenshot = makePngDataUrl(1920, 1080);
    expect(getWebCrawlScreenshotOmissionReason(screenshot)).toBeNull();
  });

  it("returns omission reason for oversized screenshots", () => {
    const screenshot = makePngDataUrl(8001, 6000);
    expect(getWebCrawlScreenshotOmissionReason(screenshot)).toMatch(
      /exceeds the supported vision input limit/,
    );
  });

  it("reads image dimensions from raw base64 payloads", () => {
    const screenshot = Buffer.alloc(33).toString("base64");
    // Invalid/undersized payload should return null dimensions and no omission reason.
    expect(getWebCrawlImageDimensions(screenshot)).toBeNull();
    expect(getWebCrawlScreenshotOmissionReason(screenshot)).toBeNull();
  });

  it("reads JPEG dimensions", () => {
    const screenshot = makeJpegDataUrl(800, 600);
    const dims = getWebCrawlImageDimensions(screenshot);
    expect(dims).toEqual({ width: 800, height: 600 });
  });

  it("reads GIF dimensions", () => {
    const screenshot = makeGifDataUrl(320, 240);
    const dims = getWebCrawlImageDimensions(screenshot);
    expect(dims).toEqual({ width: 320, height: 240 });
  });

  it("reads WebP VP8X dimensions", () => {
    const screenshot = makeWebpVP8XDataUrl(1024, 768);
    const dims = getWebCrawlImageDimensions(screenshot);
    expect(dims).toEqual({ width: 1024, height: 768 });
  });

  it("reads WebP VP8 (lossy) dimensions", () => {
    const screenshot = makeWebpVP8DataUrl(640, 480);
    const dims = getWebCrawlImageDimensions(screenshot);
    expect(dims).toEqual({ width: 640, height: 480 });
  });

  it("reads WebP VP8L (lossless) dimensions", () => {
    const screenshot = makeWebpVP8LDataUrl(512, 384);
    const dims = getWebCrawlImageDimensions(screenshot);
    expect(dims).toEqual({ width: 512, height: 384 });
  });
});
