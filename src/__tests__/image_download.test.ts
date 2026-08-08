import { describe, expect, it } from "vitest";

import { extensionForBytes } from "@/components/chat-agent/image_download";

function head(...bytes: number[]): Uint8Array {
  const out = new Uint8Array(12);
  out.set(bytes);
  return out;
}

describe("extensionForBytes", () => {
  it("trusts the bytes over a wrong content-type", () => {
    // Hermes serves its cache by filename, so a .png can carry JPEG bytes.
    expect(extensionForBytes(head(0xff, 0xd8, 0xff, 0xe0), "image/png")).toBe(
      "jpg",
    );
  });

  it("recognises PNG", () => {
    expect(extensionForBytes(head(0x89, 0x50, 0x4e, 0x47), "")).toBe("png");
  });

  it("recognises GIF", () => {
    expect(extensionForBytes(head(0x47, 0x49, 0x46, 0x38), "")).toBe("gif");
  });

  it("recognises WEBP by its RIFF header", () => {
    const riff = head(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0);
    riff[8] = 0x57;
    riff[9] = 0x45;
    expect(extensionForBytes(riff, "")).toBe("webp");
  });

  it("falls back to the content-type when bytes are unknown", () => {
    expect(extensionForBytes(head(0x00, 0x01), "image/svg+xml")).toBe(
      "svg+xml",
    );
  });

  it("normalises jpeg to jpg", () => {
    expect(extensionForBytes(head(0x00), "image/jpeg")).toBe("jpg");
  });

  it("defaults to png when nothing identifies it", () => {
    expect(extensionForBytes(head(0x00), "application/octet-stream")).toBe(
      "png",
    );
  });
});
