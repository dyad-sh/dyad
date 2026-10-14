import { describe, expect, it } from "vitest";
import {
  PREVIEW_ADDRESS_PATH_ERROR,
  formatPreviewAddressPath,
  normalizePreviewAddressPath,
  sameOriginStartPath,
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

  describe("sameOriginStartPath", () => {
    const APP = "http://localhost:5173/";

    it("returns the route while the preview is on the app's origin", () => {
      expect(sameOriginStartPath("http://localhost:5173/about", APP)).toBe(
        "/about",
      );
      expect(
        sameOriginStartPath("http://localhost:5173/about?x=1#top", APP),
      ).toBe("/about?x=1#top");
    });

    it("gives no hint once the preview has followed an off-origin link", () => {
      // The regression this guard exists for: `formatPreviewAddressPath` strips
      // the origin unconditionally, so without the check an external link would
      // replay as `page.goto("/pricing")` against the app.
      expect(
        sameOriginStartPath("https://example.com/pricing", APP),
      ).toBeUndefined();
    });

    it("treats a different port on the same host as off-origin", () => {
      expect(
        sameOriginStartPath("http://localhost:5174/about", APP),
      ).toBeUndefined();
    });

    it("gives no hint when either URL is missing or unparseable", () => {
      expect(sameOriginStartPath(null, APP)).toBeUndefined();
      expect(
        sameOriginStartPath("http://localhost:5173/about", null),
      ).toBeUndefined();
      expect(sameOriginStartPath("not a url", APP)).toBeUndefined();
      expect(
        sameOriginStartPath("http://localhost:5173/about", "not a url"),
      ).toBeUndefined();
    });

    it("reports the app root as a route rather than as no hint", () => {
      expect(sameOriginStartPath(APP, APP)).toBe("/");
    });
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
