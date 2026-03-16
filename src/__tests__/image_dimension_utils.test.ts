import { describe, it, expect } from "vitest";
import {
  getImageDimensionsFromDataUrl,
  exceedsMaxDimension,
  validateImageDimensions,
  MAX_IMAGE_DIMENSION,
} from "@/pro/main/ipc/handlers/local_agent/tools/image_utils";

describe("image_dimension_utils", () => {
  describe("getImageDimensionsFromDataUrl", () => {
    it("returns null for non-data URLs", () => {
      expect(
        getImageDimensionsFromDataUrl("https://example.com/image.png"),
      ).toBeNull();
    });

    it("returns null for invalid data URL format", () => {
      expect(
        getImageDimensionsFromDataUrl("data:text/plain;base64,SGVsbG8="),
      ).toBeNull();
    });

    it("parses PNG dimensions correctly", () => {
      // 1x1 PNG image
      const png1x1 =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const dimensions = getImageDimensionsFromDataUrl(png1x1);
      expect(dimensions).toEqual({ width: 1, height: 1 });
    });

    it("parses 2x2 PNG dimensions correctly", () => {
      // 2x2 PNG image
      const png2x2 =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QzwAEjDAGACHSA/0Xj1nMAAAAAElFTkSuQmCC";
      const dimensions = getImageDimensionsFromDataUrl(png2x2);
      expect(dimensions).toEqual({ width: 2, height: 2 });
    });

    it("parses JPEG dimensions correctly", () => {
      // 1x1 JPEG image (minimal valid JPEG)
      const jpeg1x1 =
        "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBEQCEAwEPwAB//9k=";
      const dimensions = getImageDimensionsFromDataUrl(jpeg1x1);
      expect(dimensions).toEqual({ width: 1, height: 1 });
    });

    it("parses GIF dimensions correctly", () => {
      const gifHeader = Buffer.from([
        // "GIF89a"
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
        // Width: 10 (little-endian)
        0x0a, 0x00,
        // Height: 20 (little-endian)
        0x14, 0x00,
      ]);
      const dataUrl = `data:image/gif;base64,${gifHeader.toString("base64")}`;
      const dimensions = getImageDimensionsFromDataUrl(dataUrl);
      expect(dimensions).toEqual({ width: 10, height: 20 });
    });

    it("returns null for truncated PNG", () => {
      // Truncated PNG (too short to contain dimensions)
      const truncatedPng = "data:image/png;base64,iVBORw0KGgo=";
      expect(getImageDimensionsFromDataUrl(truncatedPng)).toBeNull();
    });

    it("returns null for invalid PNG signature", () => {
      // Invalid PNG (wrong signature)
      const invalidPng =
        "data:image/png;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
      expect(getImageDimensionsFromDataUrl(invalidPng)).toBeNull();
    });

    it("handles case-insensitive MIME types", () => {
      // 1x1 PNG with uppercase MIME type
      const png1x1 =
        "data:image/PNG;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const dimensions = getImageDimensionsFromDataUrl(png1x1);
      expect(dimensions).toEqual({ width: 1, height: 1 });
    });
  });

  describe("exceedsMaxDimension", () => {
    it("returns false for dimensions within limit", () => {
      expect(exceedsMaxDimension({ width: 1920, height: 1080 })).toBe(false);
      expect(exceedsMaxDimension({ width: 8000, height: 8000 })).toBe(false);
    });

    it("returns true when width exceeds limit", () => {
      expect(exceedsMaxDimension({ width: 8001, height: 1080 })).toBe(true);
      expect(exceedsMaxDimension({ width: 10000, height: 100 })).toBe(true);
    });

    it("returns true when height exceeds limit", () => {
      expect(exceedsMaxDimension({ width: 1920, height: 8001 })).toBe(true);
      expect(exceedsMaxDimension({ width: 100, height: 10000 })).toBe(true);
    });

    it("returns true when both dimensions exceed limit", () => {
      expect(exceedsMaxDimension({ width: 9000, height: 9000 })).toBe(true);
    });

    it("respects custom max dimension", () => {
      expect(exceedsMaxDimension({ width: 1500, height: 1500 }, 1000)).toBe(
        true,
      );
      expect(exceedsMaxDimension({ width: 800, height: 800 }, 1000)).toBe(
        false,
      );
    });
  });

  describe("validateImageDimensions", () => {
    it("returns valid for non-data URLs", () => {
      // Can't parse dimensions from regular URLs, so we let them through
      const result = validateImageDimensions("https://example.com/image.png");
      expect(result.isValid).toBe(true);
      expect(result.dimensions).toBeUndefined();
    });

    it("returns valid for images within dimension limits", () => {
      // 1x1 PNG
      const png1x1 =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const result = validateImageDimensions(png1x1);
      expect(result.isValid).toBe(true);
      expect(result.dimensions).toEqual({ width: 1, height: 1 });
    });

    it("returns invalid with error message for oversized images", () => {
      // Build a minimal PNG header with width=8001, height=100
      const pngHeader = Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a, // PNG signature
        0x00,
        0x00,
        0x00,
        0x0d,
        0x49,
        0x48,
        0x44,
        0x52, // IHDR length + type
        0x00,
        0x00,
        0x1f,
        0x41, // width = 8001 (big-endian)
        0x00,
        0x00,
        0x00,
        0x64, // height = 100 (big-endian)
        0x08,
        0x02,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
      ]);
      const dataUrl = `data:image/png;base64,${pngHeader.toString("base64")}`;
      const result = validateImageDimensions(dataUrl);
      expect(result.isValid).toBe(false);
      expect(result.dimensions).toEqual({ width: 8001, height: 100 });
      expect(result.errorMessage).toContain("8001x100");
      expect(result.errorMessage).toContain(String(MAX_IMAGE_DIMENSION));
    });

    it("returns valid for unparseable images (letting LLM provider handle them)", () => {
      // Truncated/invalid image data - we let these through
      const invalidData = "data:image/png;base64,notvalidbase64";
      const result = validateImageDimensions(invalidData);
      expect(result.isValid).toBe(true);
    });
  });

  describe("MAX_IMAGE_DIMENSION constant", () => {
    it("is set to 8000", () => {
      expect(MAX_IMAGE_DIMENSION).toBe(8000);
    });
  });
});
