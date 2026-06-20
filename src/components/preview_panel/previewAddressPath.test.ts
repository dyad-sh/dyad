import { describe, expect, it } from "vitest";
import {
  PREVIEW_ADDRESS_PATH_ERROR,
  formatPreviewAddressPath,
  normalizePreviewAddressPath,
} from "./previewAddressPath";

describe("previewAddressPath", () => {
  it("formats preview URLs as relative paths", () => {
    expect(
      formatPreviewAddressPath("http://localhost:5173/about?x=1#top"),
    ).toBe("/about?x=1#top");
    expect(formatPreviewAddressPath("not a url")).toBe("/");
    expect(formatPreviewAddressPath(null)).toBe("/");
  });

  it("normalizes relative address bar input", () => {
    expect(normalizePreviewAddressPath("/about")).toEqual({
      type: "valid",
      path: "/about",
    });
    expect(normalizePreviewAddressPath("about")).toEqual({
      type: "valid",
      path: "/about",
    });
    expect(normalizePreviewAddressPath("about?x=1#top")).toEqual({
      type: "valid",
      path: "/about?x=1#top",
    });
    expect(normalizePreviewAddressPath("?x=1#top")).toEqual({
      type: "valid",
      path: "/?x=1#top",
    });
    expect(normalizePreviewAddressPath("#top")).toEqual({
      type: "valid",
      path: "/#top",
    });
  });

  it("treats empty input as a no-op", () => {
    expect(normalizePreviewAddressPath("   ")).toEqual({ type: "empty" });
  });

  it("rejects non-relative address bar input", () => {
    for (const value of [
      "https://example.com/about",
      "mailto:test@example.com",
      "//example.com/about",
      "C:\\Users\\mini",
      "\\\\server\\share",
    ]) {
      expect(normalizePreviewAddressPath(value)).toEqual({
        type: "invalid",
        message: PREVIEW_ADDRESS_PATH_ERROR,
      });
    }
  });
});
