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
});
