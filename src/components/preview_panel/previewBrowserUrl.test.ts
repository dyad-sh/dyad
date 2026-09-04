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
        appUrl: "http://app-42.localhost:42142",
        createCloudSandboxShareLink,
      }),
    ).resolves.toBe("https://dyad.sh/share/sandbox-1");

    expect(createCloudSandboxShareLink).toHaveBeenCalledWith({
      appId: 42,
    });
  });

  it("returns the isolated proxy URL for non-cloud previews", async () => {
    const createCloudSandboxShareLink = vi.fn();

    await expect(
      resolvePreviewBrowserUrl({
        isCloudMode: false,
        selectedAppId: null,
        appUrl: "http://app-42.localhost:42142",
        createCloudSandboxShareLink,
      }),
    ).resolves.toBe("http://app-42.localhost:42142");

    expect(createCloudSandboxShareLink).not.toHaveBeenCalled();
  });

  it("throws when cloud preview browser open is requested without an app id", async () => {
    await expect(
      resolvePreviewBrowserUrl({
        isCloudMode: true,
        selectedAppId: null,
        appUrl: "http://app-42.localhost:42142",
        createCloudSandboxShareLink: vi.fn(),
      }),
    ).rejects.toThrow("Cloud sandbox is not running.");
  });
});
