import { describe, expect, it } from "vitest";
import {
  getAppPreviewHostname,
  isAppPreviewHostname,
  toAppPreviewUrl,
} from "./app_preview_url";

describe("app preview URLs", () => {
  it("uses the stable numeric app id instead of mutable app metadata", () => {
    expect(getAppPreviewHostname(42)).toBe("app-42.localhost");
    expect(isAppPreviewHostname(42, "app-42.localhost")).toBe(true);
    expect(isAppPreviewHostname(43, "app-42.localhost")).toBe(false);
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "isolates a %s runtime URL while preserving the rest of the URL",
    (hostname) => {
      expect(
        toAppPreviewUrl(
          42,
          `http://${hostname}:42142/settings?tab=profile#security`,
        ),
      ).toBe("http://app-42.localhost:42142/settings?tab=profile#security");
    },
  );

  it.each([
    "https://preview.example.test/app",
    "https://sandbox.dyad.sh/session/abc",
  ])("leaves non-loopback preview URLs unchanged", (url) => {
    expect(toAppPreviewUrl(42, url)).toBe(url);
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects invalid app ids: %s", (appId) => {
    expect(() => getAppPreviewHostname(appId)).toThrow(
      "Invalid app id for preview hostname",
    );
  });
});
