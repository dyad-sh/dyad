import { describe, expect, it } from "vitest";
import {
  getAppPreviewHostname,
  isAppPreviewHostname,
  isAppPreviewStorageScopeAllowed,
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

  it("returns the shared localhost URL when isolation is disabled", () => {
    expect(toAppPreviewUrl(42, "http://localhost:42142/app", false)).toBe(
      "http://localhost:42142/app",
    );
    expect(
      toAppPreviewUrl(42, "http://app-42.localhost:42142/app", false),
    ).toBe("http://localhost:42142/app");
  });

  it("allows only the selected storage scope for the active setting", () => {
    expect(isAppPreviewStorageScopeAllowed(42, "app-42.localhost", true)).toBe(
      true,
    );
    expect(isAppPreviewStorageScopeAllowed(42, "localhost", true)).toBe(false);
    expect(isAppPreviewStorageScopeAllowed(42, "localhost", false)).toBe(true);
    expect(isAppPreviewStorageScopeAllowed(42, "example.com", false)).toBe(
      false,
    );
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects invalid app ids: %s", (appId) => {
    expect(() => getAppPreviewHostname(appId)).toThrow(
      "Invalid app id for preview hostname",
    );
  });
});
