import { describe, expect, it, vi } from "vitest";
import { resolvePreviewBrowserUrl } from "./previewBrowserUrl";

describe("resolvePreviewBrowserUrl", () => {
  it("returns a cloud share link instead of the raw preview URL", async () => {
    const createCloudSandboxShareLink = vi
      .fn()
      .mockResolvedValue({ url: "https://dyad.sh/share/sandbox-1" });

    await expect(
      resolvePreviewBrowserUrl({
        isCloudMode: true,
        selectedAppId: 42,
        appUrl: "https://preview.internal.test",
        originalUrl: "https://sandbox.internal.test",
        createCloudSandboxShareLink,
      }),
    ).resolves.toBe("https://dyad.sh/share/sandbox-1");

    expect(createCloudSandboxShareLink).toHaveBeenCalledWith({
      appId: 42,
    });
  });

  it("opens app-specific previews at the localhost dev-server URL", async () => {
    const createCloudSandboxShareLink = vi.fn();

    await expect(
      resolvePreviewBrowserUrl({
        isCloudMode: false,
        selectedAppId: null,
        appUrl: "http://app-42.localhost:42142",
        originalUrl: "http://localhost:5173/",
        createCloudSandboxShareLink,
      }),
    ).resolves.toBe("http://localhost:5173/");

    expect(createCloudSandboxShareLink).not.toHaveBeenCalled();
  });

  it.each([
    "http://localhost:42142",
    "http://127.0.0.1:42142/path?q=1#hash",
    "https://preview.example.com/path?q=1#hash",
  ])("preserves other preview URLs: %s", async (appUrl) => {
    await expect(
      resolvePreviewBrowserUrl({
        isCloudMode: false,
        selectedAppId: 42,
        appUrl,
        originalUrl: "http://localhost:5173/",
        createCloudSandboxShareLink: vi.fn(),
      }),
    ).resolves.toBe(appUrl);
  });

  it("requires the dev-server URL instead of opening the isolated proxy", async () => {
    await expect(
      resolvePreviewBrowserUrl({
        isCloudMode: false,
        selectedAppId: 42,
        appUrl: "http://app-42.localhost:42142",
        originalUrl: null,
        createCloudSandboxShareLink: vi.fn(),
      }),
    ).rejects.toThrow("Dev server URL is unavailable.");
  });

  it("throws when cloud preview browser open is requested without an app id", async () => {
    await expect(
      resolvePreviewBrowserUrl({
        isCloudMode: true,
        selectedAppId: null,
        appUrl: "https://preview.internal.test",
        originalUrl: null,
        createCloudSandboxShareLink: vi.fn(),
      }),
    ).rejects.toThrow("Cloud sandbox is not running.");
  });
});
