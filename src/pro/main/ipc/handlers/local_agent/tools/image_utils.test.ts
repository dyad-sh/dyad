import { describe, it, expect } from "vitest";
import {
  getImageDimensionsFromDataUrl,
  isImageTooLarge,
  MAX_IMAGE_DIMENSION,
} from "@/pro/main/ipc/handlers/local_agent/tools/image_utils";

describe("image_utils", () => {
  describe("getImageDimensionsFromDataUrl", () => {
    it("returns null for invalid data URL format", () => {
      expect(getImageDimensionsFromDataUrl("not a data url")).toBeNull();
      expect(
        getImageDimensionsFromDataUrl("data:text/plain;base64,abc"),
      ).toBeNull();
      expect(getImageDimensionsFromDataUrl("")).toBeNull();
    });

    it("extracts dimensions from a valid PNG data URL", () => {
      // Minimal 1x1 PNG (red pixel)
      const png1x1 =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const result = getImageDimensionsFromDataUrl(png1x1);
      expect(result).toEqual({ width: 1, height: 1 });
    });

    it("extracts dimensions from a 100x50 PNG", () => {
      // 100x50 PNG (minimal valid header)
      // PNG signature + IHDR chunk with width=100, height=50
      const pngHeader = Buffer.from([
        // PNG signature
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        // IHDR chunk length (13 bytes)
        0x00, 0x00, 0x00, 0x0d,
        // "IHDR"
        0x49, 0x48, 0x44, 0x52,
        // Width: 100 (big-endian)
        0x00, 0x00, 0x00, 0x64,
        // Height: 50 (big-endian)
        0x00, 0x00, 0x00, 0x32,
        // Bit depth, color type, compression, filter, interlace
        0x08, 0x02, 0x00, 0x00, 0x00,
        // CRC (dummy)
        0x00, 0x00, 0x00, 0x00,
      ]);
      const dataUrl = `data:image/png;base64,${pngHeader.toString("base64")}`;
      const result = getImageDimensionsFromDataUrl(dataUrl);
      expect(result).toEqual({ width: 100, height: 50 });
    });

    it("extracts dimensions from a GIF data URL", () => {
      // Minimal GIF with 10x20 dimensions
      const gifHeader = Buffer.from([
        // "GIF89a"
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
        // Width: 10 (little-endian)
        0x0a, 0x00,
        // Height: 20 (little-endian)
        0x14, 0x00,
      ]);
      const dataUrl = `data:image/gif;base64,${gifHeader.toString("base64")}`;
      const result = getImageDimensionsFromDataUrl(dataUrl);
      expect(result).toEqual({ width: 10, height: 20 });
    });

    it("returns null for truncated image data", () => {
      // PNG signature only, no IHDR
      const truncated = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const dataUrl = `data:image/png;base64,${truncated.toString("base64")}`;
      const result = getImageDimensionsFromDataUrl(dataUrl);
      expect(result).toBeNull();
    });

    it("returns null for corrupted PNG signature", () => {
      const corrupted = Buffer.from([
        // Invalid signature
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        // IHDR chunk
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x64,
        0x00, 0x00, 0x00, 0x32, 0x08, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00,
      ]);
      const dataUrl = `data:image/png;base64,${corrupted.toString("base64")}`;
      const result = getImageDimensionsFromDataUrl(dataUrl);
      expect(result).toBeNull();
    });
  });

  describe("isImageTooLarge", () => {
    it("returns false for images within limits", () => {
      expect(isImageTooLarge({ width: 1000, height: 1000 })).toBe(false);
      expect(isImageTooLarge({ width: 8000, height: 8000 })).toBe(false);
      expect(isImageTooLarge({ width: 1, height: 1 })).toBe(false);
    });

    it("returns true when width exceeds limit", () => {
      expect(isImageTooLarge({ width: 8001, height: 1000 })).toBe(true);
      expect(isImageTooLarge({ width: 10000, height: 100 })).toBe(true);
    });

    it("returns true when height exceeds limit", () => {
      expect(isImageTooLarge({ width: 1000, height: 8001 })).toBe(true);
      expect(isImageTooLarge({ width: 100, height: 10000 })).toBe(true);
    });

    it("returns true when both dimensions exceed limit", () => {
      expect(isImageTooLarge({ width: 9000, height: 9000 })).toBe(true);
    });

    it("respects custom max dimension", () => {
      expect(isImageTooLarge({ width: 500, height: 500 }, 400)).toBe(true);
      expect(isImageTooLarge({ width: 300, height: 300 }, 400)).toBe(false);
    });
  });

  describe("MAX_IMAGE_DIMENSION", () => {
    it("is set to 8000", () => {
      expect(MAX_IMAGE_DIMENSION).toBe(8000);
    });
  });
});
