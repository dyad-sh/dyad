import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleSupabaseOAuthReturn } from "@/supabase_admin/supabase_return_handler";
import { readSettings, writeSettings } from "@/main/settings";
import { listSupabaseOrganizations } from "@/supabase_admin/supabase_management_client";

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(),
  writeSettings: vi.fn(),
}));

vi.mock("@/supabase_admin/supabase_management_client", () => ({
  listSupabaseOrganizations: vi.fn(),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      error: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

describe("handleSupabaseOAuthReturn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readSettings).mockReturnValue({
      selectedModel: { name: "auto", provider: "auto" },
      providerSettings: {},
      telemetryConsent: "unset",
      telemetryUserId: "test-user",
      hasRunBefore: false,
      experiments: {},
      enableProLazyEditsMode: true,
      enableProSmartFilesContextMode: true,
      selectedChatMode: "build",
      enableAutoFixProblems: false,
      enableAutoUpdate: true,
      releaseChannel: "stable",
      selectedTemplateId: "react",
      selectedThemeId: "default",
      isRunning: false,
      enableNativeGit: true,
      autoExpandPreviewPanel: true,
      enableContextCompaction: true,
      supabase: {
        organizations: {
          "existing-org": {
            accessToken: {
              value: "existing-access",
              encryptionType: "plaintext",
            },
            refreshToken: {
              value: "existing-refresh",
              encryptionType: "plaintext",
            },
            expiresIn: 3600,
            tokenTimestamp: 1000,
          },
        },
      },
    } as any);
  });

  it("stores credentials for all returned organization slugs", async () => {
    vi.mocked(listSupabaseOrganizations).mockResolvedValue([
      { slug: "org-a" },
      { slug: "org-b" },
    ] as any);

    await handleSupabaseOAuthReturn({
      token: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresIn: 7200,
    });

    expect(writeSettings).toHaveBeenCalledTimes(1);
    expect(writeSettings).toHaveBeenCalledWith({
      supabase: {
        organizations: {
          "existing-org": {
            accessToken: {
              value: "existing-access",
              encryptionType: "plaintext",
            },
            refreshToken: {
              value: "existing-refresh",
              encryptionType: "plaintext",
            },
            expiresIn: 3600,
            tokenTimestamp: 1000,
          },
          "org-a": {
            accessToken: { value: "new-access-token" },
            refreshToken: { value: "new-refresh-token" },
            expiresIn: 7200,
            tokenTimestamp: expect.any(Number),
          },
          "org-b": {
            accessToken: { value: "new-access-token" },
            refreshToken: { value: "new-refresh-token" },
            expiresIn: 7200,
            tokenTimestamp: expect.any(Number),
          },
        },
      },
    });
  });

  it("falls back to legacy token fields when organization lookup fails", async () => {
    vi.mocked(listSupabaseOrganizations).mockRejectedValue(new Error("boom"));

    await handleSupabaseOAuthReturn({
      token: "legacy-access",
      refreshToken: "legacy-refresh",
      expiresIn: 1800,
    });

    expect(writeSettings).toHaveBeenCalledTimes(1);
    expect(writeSettings).toHaveBeenCalledWith({
      supabase: expect.objectContaining({
        accessToken: { value: "legacy-access" },
        refreshToken: { value: "legacy-refresh" },
        expiresIn: 1800,
        tokenTimestamp: expect.any(Number),
      }),
    });
  });
});
