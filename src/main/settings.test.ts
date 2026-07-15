import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import {
  readSettings,
  resolveEffectiveSettings,
  readEffectiveSettings,
  getSettingsFilePath,
  recordRendererCrash,
  readRendererCrashRecord,
  writeSettings,
  tryWriteSettings,
  encrypt,
  decrypt,
  notifyRendererErrorToastListenerReady,
  writeCrashSentinel,
  setSentinelActiveChat,
  readCrashSentinel,
  rewriteRecoveredSafeStorageSecretsAfterKeychainUnlock,
} from "@/main/settings";
import { getUserDataPath } from "@/paths/paths";
import { UserSettings } from "@/lib/schemas";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getRemoteDesktopConfig } from "@/ipc/shared/remote_desktop_config";
import {
  getRecoveryStats,
  recoverLegacySafeStorageSecret,
} from "@/main/safe_storage_legacy";
import { ZodError } from "zod";

const mockSend = vi.fn();
const mockWebContents = {
  send: mockSend,
} as unknown as Parameters<typeof notifyRendererErrorToastListenerReady>[0];
const mockWindow = {
  webContents: mockWebContents,
};

// Mock dependencies
vi.mock("node:fs");
vi.mock("node:path");
vi.mock("electron", () => ({
  app: {
    on: vi.fn(),
    // Legacy safeStorage recovery is gated on app readiness; default to ready so
    // recovery-path tests exercise it. Individual tests override as needed.
    isReady: vi.fn(() => true),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(() => mockWindow),
    getAllWindows: vi.fn(() => [mockWindow]),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(),
    decryptString: vi.fn(),
  },
}));
vi.mock("@/paths/paths", () => ({
  getUserDataPath: vi.fn(),
}));
vi.mock("@/ipc/shared/remote_desktop_config", () => ({
  getRemoteDesktopConfig: vi.fn(),
}));
// settings.ts falls back to legacy Keychain recovery when a secret fails to
// decrypt; unit tests must never shell out to the real `security` CLI.
vi.mock("@/main/safe_storage_legacy", () => ({
  getRecoveryStats: vi.fn(() => ({ attempted: 0, recovered: 0, failed: 0 })),
  recoverLegacySafeStorageSecret: vi.fn(() => null),
}));

const mockFs = vi.mocked(fs);
const mockPath = vi.mocked(path);
const mockSafeStorage = vi.mocked(safeStorage);
const mockGetUserDataPath = vi.mocked(getUserDataPath);
const mockGetRemoteDesktopConfig = vi.mocked(getRemoteDesktopConfig);

describe("readSettings", () => {
  const mockUserDataPath = "/mock/user/data";
  const mockSettingsPath = "/mock/user/data/user-settings.json";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserDataPath.mockReturnValue(mockUserDataPath);
    mockPath.join.mockReturnValue(mockSettingsPath);
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when settings file does not exist", () => {
    it("should create default settings file and return default settings", () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.writeFileSync.mockImplementation(() => {});

      const result = readSettings();

      expect(mockFs.existsSync).toHaveBeenCalledWith(mockSettingsPath);
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        mockSettingsPath,
        expect.stringContaining('"selectedModel"'),
      );
      expect(scrubSettings(result)).toMatchInlineSnapshot(`
        {
          "autoApproveNonSchemaSql": true,
          "autoExpandPreviewPanel": true,
          "disablePreviewNodeAutoInstall": false,
          "enableAppBlueprint": true,
          "enableAutoFixProblems": false,
          "enableAutoUpdate": true,
          "enableCodeExplorer": true,
          "enableContextCompaction": true,
          "enableMcpToolSearch": true,
          "enablePnpmMinimumReleaseAgeWarning": true,
          "enableProLazyEditsMode": true,
          "enableProSmartFilesContextMode": true,
          "enableSandboxScriptExecution": true,
          "experiments": {},
          "hasRunBefore": false,
          "isRunning": false,
          "lastKnownPerformance": undefined,
          "nodeRuntimePreference": "system",
          "previewIdleTimeoutPolicy": "default",
          "providerSettings": {},
          "releaseChannel": "stable",
          "selectedChatMode": "build",
          "selectedModel": {
            "name": "auto",
            "provider": "auto",
          },
          "selectedTemplateId": "react",
          "selectedThemeId": "default",
          "telemetryConsent": "unset",
          "telemetryUserId": "[scrubbed]",
        }
      `);
    });
  });

  describe("when settings file exists", () => {
    it("should read and merge settings with defaults", () => {
      const mockFileContent = {
        selectedModel: {
          name: "gpt-4",
          provider: "openai",
        },
        telemetryConsent: "opted_in",
        hasRunBefore: true,
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        mockSettingsPath,
        "utf-8",
      );
      expect(result.selectedModel).toEqual({
        name: "gpt-4",
        provider: "openai",
      });
      expect(result.telemetryConsent).toBe("opted_in");
      expect(result.hasRunBefore).toBe(true);
      // Should still have defaults for missing properties
      expect(result.blockUnsafeNpmPackages).toBeUndefined();
      expect(result.enableAutoUpdate).toBe(true);
      expect(result.releaseChannel).toBe("stable");
    });

    it("should treat existing settings files without hasRunBefore as already run", () => {
      const mockFileContent = {
        selectedModel: {
          name: "gpt-4",
          provider: "openai",
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      expect(result.hasRunBefore).toBe(true);
    });

    it("should decrypt encrypted provider API keys", () => {
      const mockFileContent = {
        providerSettings: {
          openai: {
            apiKey: {
              value: "encrypted-api-key",
              encryptionType: "electron-safe-storage",
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));
      mockSafeStorage.decryptString.mockReturnValue("decrypted-api-key");

      const result = readSettings();

      expect(mockSafeStorage.decryptString).toHaveBeenCalledWith(
        Buffer.from("encrypted-api-key", "base64"),
      );
      expect(result.providerSettings.openai.apiKey).toEqual({
        value: "decrypted-api-key",
        encryptionType: "electron-safe-storage",
      });
    });

    it("should decrypt encrypted GitHub access token", () => {
      const mockFileContent = {
        githubAccessToken: {
          value: "encrypted-github-token",
          encryptionType: "electron-safe-storage",
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));
      mockSafeStorage.decryptString.mockReturnValue("decrypted-github-token");

      const result = readSettings();

      expect(mockSafeStorage.decryptString).toHaveBeenCalledWith(
        Buffer.from("encrypted-github-token", "base64"),
      );
      expect(result.githubAccessToken).toEqual({
        value: "decrypted-github-token",
        encryptionType: "electron-safe-storage",
      });
    });

    it("should decrypt encrypted Supabase tokens", () => {
      const mockFileContent = {
        supabase: {
          accessToken: {
            value: "encrypted-access-token",
            encryptionType: "electron-safe-storage",
          },
          refreshToken: {
            value: "encrypted-refresh-token",
            encryptionType: "electron-safe-storage",
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));
      mockSafeStorage.decryptString
        .mockReturnValueOnce("decrypted-refresh-token")
        .mockReturnValueOnce("decrypted-access-token");

      const result = readSettings();

      expect(mockSafeStorage.decryptString).toHaveBeenCalledTimes(2);
      expect(result.supabase?.refreshToken).toEqual({
        value: "decrypted-refresh-token",
        encryptionType: "electron-safe-storage",
      });
      expect(result.supabase?.accessToken).toEqual({
        value: "decrypted-access-token",
        encryptionType: "electron-safe-storage",
      });
    });

    it("should handle plaintext secrets without decryption", () => {
      const mockFileContent = {
        githubAccessToken: {
          value: "plaintext-token",
          encryptionType: "plaintext",
        },
        providerSettings: {
          openai: {
            apiKey: {
              value: "plaintext-api-key",
              encryptionType: "plaintext",
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      expect(mockSafeStorage.decryptString).not.toHaveBeenCalled();
      expect(result.githubAccessToken?.value).toBe("plaintext-token");
      expect(result.providerSettings.openai.apiKey?.value).toBe(
        "plaintext-api-key",
      );
    });

    it("should trim whitespace from decrypted API keys", () => {
      const mockFileContent = {
        providerSettings: {
          openai: {
            apiKey: {
              value: "encrypted-api-key",
              encryptionType: "electron-safe-storage",
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));
      mockSafeStorage.decryptString.mockReturnValue(
        "  decrypted-api-key-with-spaces\n",
      );

      const result = readSettings();

      expect(result.providerSettings.openai.apiKey).toEqual({
        value: "decrypted-api-key-with-spaces",
        encryptionType: "electron-safe-storage",
      });
    });

    it("should trim whitespace from plaintext secrets", () => {
      const mockFileContent = {
        githubAccessToken: {
          value: "  plaintext-token-with-spaces\n",
          encryptionType: "plaintext",
        },
        providerSettings: {
          openai: {
            apiKey: {
              value: "\nplaintext-api-key\n",
              encryptionType: "plaintext",
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      expect(result.githubAccessToken?.value).toBe(
        "plaintext-token-with-spaces",
      );
      expect(result.providerSettings.openai.apiKey?.value).toBe(
        "plaintext-api-key",
      );
    });

    it("should handle secrets without encryptionType", () => {
      const mockFileContent = {
        githubAccessToken: {
          value: "token-without-encryption-type",
        },
        providerSettings: {
          openai: {
            apiKey: {
              value: "api-key-without-encryption-type",
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      expect(mockSafeStorage.decryptString).not.toHaveBeenCalled();
      expect(result.githubAccessToken?.value).toBe(
        "token-without-encryption-type",
      );
      expect(result.providerSettings.openai.apiKey?.value).toBe(
        "api-key-without-encryption-type",
      );
    });

    it("should migrate deprecated 'agent' chat mode to 'build'", () => {
      const mockFileContent = {
        selectedModel: {
          name: "gpt-4",
          provider: "openai",
        },
        selectedChatMode: "agent",
        defaultChatMode: "agent",
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      // "agent" should be migrated to "build"
      expect(result.selectedChatMode).toBe("build");
      expect(result.defaultChatMode).toBe("build");
    });

    it("should preserve non-deprecated chat modes", () => {
      const mockFileContent = {
        selectedModel: {
          name: "gpt-4",
          provider: "openai",
        },
        selectedChatMode: "local-agent",
        defaultChatMode: "ask",
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      expect(result.selectedChatMode).toBe("local-agent");
      expect(result.defaultChatMode).toBe("ask");
    });

    it("should migrate deprecated 'agent' chat mode to 'build'", () => {
      const mockFileContent = {
        selectedModel: {
          name: "gpt-4",
          provider: "openai",
        },
        selectedChatMode: "agent",
        defaultChatMode: "agent",
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      // "agent" should be converted to "build" on read
      expect(result.selectedChatMode).toBe("build");
      expect(result.defaultChatMode).toBe("build");
    });

    it("should preserve non-deprecated chat modes during migration", () => {
      const mockFileContent = {
        selectedModel: {
          name: "gpt-4",
          provider: "openai",
        },
        selectedChatMode: "local-agent",
        defaultChatMode: "ask",
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      // non-deprecated modes should be preserved
      expect(result.selectedChatMode).toBe("local-agent");
      expect(result.defaultChatMode).toBe("ask");
    });

    it("should preserve extra fields not recognized by the schema", () => {
      const mockFileContent = {
        selectedModel: {
          name: "gpt-4",
          provider: "openai",
        },
        telemetryConsent: "opted_in",
        hasRunBefore: true,
        // Extra fields that are not in the schema (should be preserved)
        unknownField: "should be preserved",
        deprecatedSetting: true,
        extraConfig: {
          someValue: 123,
          anotherValue: "test",
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        mockSettingsPath,
        "utf-8",
      );
      expect(result.selectedModel).toEqual({
        name: "gpt-4",
        provider: "openai",
      });
      expect(result.telemetryConsent).toBe("opted_in");
      expect(result.hasRunBefore).toBe(true);

      // Extra fields should be preserved by passthrough()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultAny = result as any;
      expect(resultAny.unknownField).toBe("should be preserved");
      expect(resultAny.deprecatedSetting).toBe(true);
      expect(resultAny.extraConfig).toEqual({
        someValue: 123,
        anotherValue: "test",
      });

      // Should still have defaults for missing properties
      expect(result.enableAutoUpdate).toBe(true);
      expect(result.releaseChannel).toBe("stable");
    });
  });

  describe("error handling", () => {
    it("should return default settings when file read fails", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new DyadError("File read error", DyadErrorKind.External);
      });

      const result = readSettings();

      expect(scrubSettings(result)).toMatchInlineSnapshot(`
        {
          "autoApproveNonSchemaSql": true,
          "autoExpandPreviewPanel": true,
          "disablePreviewNodeAutoInstall": false,
          "enableAppBlueprint": true,
          "enableAutoFixProblems": false,
          "enableAutoUpdate": true,
          "enableCodeExplorer": true,
          "enableContextCompaction": true,
          "enableMcpToolSearch": true,
          "enablePnpmMinimumReleaseAgeWarning": true,
          "enableProLazyEditsMode": true,
          "enableProSmartFilesContextMode": true,
          "enableSandboxScriptExecution": true,
          "experiments": {},
          "hasRunBefore": false,
          "isRunning": false,
          "lastKnownPerformance": undefined,
          "nodeRuntimePreference": "system",
          "previewIdleTimeoutPolicy": "default",
          "providerSettings": {},
          "releaseChannel": "stable",
          "selectedChatMode": "build",
          "selectedModel": {
            "name": "auto",
            "provider": "auto",
          },
          "selectedTemplateId": "react",
          "selectedThemeId": "default",
          "telemetryConsent": "unset",
          "telemetryUserId": "[scrubbed]",
        }
      `);
    });

    it("should return default settings when JSON parsing fails", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("invalid json");

      const result = readSettings();

      expect(result).toMatchObject({
        selectedModel: {
          name: "auto",
          provider: "auto",
        },
        releaseChannel: "stable",
      });
    });

    it("should return default settings when schema validation fails", () => {
      const mockFileContent = {
        selectedModel: {
          name: "gpt-4",
          // Missing required 'provider' field
        },
        releaseChannel: "invalid-channel", // Invalid enum value
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));

      const result = readSettings();

      expect(result).toMatchObject({
        selectedModel: {
          name: "auto",
          provider: "auto",
        },
        releaseChannel: "stable",
      });
    });

    it("should drop a secret that cannot be decrypted without discarding settings", () => {
      const mockFileContent = {
        selectedModel: {
          name: "gpt-4",
          provider: "openai",
        },
        telemetryConsent: "opted_in",
        githubAccessToken: {
          value: "corrupted-encrypted-data",
          encryptionType: "electron-safe-storage",
        },
        providerSettings: {
          openai: {
            apiKey: {
              value: "plaintext-api-key",
              encryptionType: "plaintext",
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));
      mockSafeStorage.decryptString.mockImplementation(() => {
        throw new DyadError("Decryption failed", DyadErrorKind.External);
      });

      const result = readSettings();

      expect(result.selectedModel).toEqual({
        name: "gpt-4",
        provider: "openai",
      });
      expect(result.telemetryConsent).toBe("opted_in");
      expect(result.githubAccessToken).toBeUndefined();
      expect(result.providerSettings.openai.apiKey?.value).toBe(
        "plaintext-api-key",
      );
    });

    it("should not treat safeStorage readiness errors as corrupt secrets", () => {
      const mockFileContent = {
        selectedModel: {
          name: "gpt-4",
          provider: "openai",
        },
        githubAccessToken: {
          value: "encrypted-token",
          encryptionType: "electron-safe-storage",
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));
      mockSafeStorage.decryptString.mockImplementation(() => {
        throw new Error("safeStorage cannot be used before app is ready");
      });

      const result = readSettings();

      expect(result.selectedModel).toEqual({
        name: "auto",
        provider: "auto",
      });
      expect(result.githubAccessToken).toBeUndefined();
    });

    it("should drop a Supabase organization when one organization secret cannot be decrypted", () => {
      const mockFileContent = {
        selectedModel: {
          name: "gpt-4",
          provider: "openai",
        },
        supabase: {
          organizations: {
            badOrg: {
              accessToken: {
                value: "corrupted-access-token",
                encryptionType: "electron-safe-storage",
              },
              refreshToken: {
                value: "encrypted-refresh-token",
                encryptionType: "electron-safe-storage",
              },
              expiresIn: 3600,
              tokenTimestamp: 123,
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));
      mockSafeStorage.decryptString.mockImplementationOnce(() => {
        throw new DyadError("Decryption failed", DyadErrorKind.External);
      });

      const result = readSettings();

      expect(result.selectedModel).toEqual({
        name: "gpt-4",
        provider: "openai",
      });
      expect(result.supabase?.organizations).toEqual({});
    });
  });

  describe("effective settings", () => {
    it("applies the remote default when the user has not explicitly set the setting", async () => {
      mockGetRemoteDesktopConfig.mockResolvedValue({
        defaults: { blockUnsafeNpmPackages: false },
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({}));

      const result = await readEffectiveSettings();

      expect(result.blockUnsafeNpmPackages).toBe(false);
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it("does not override an explicitly stored local value", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({}));

      const result = resolveEffectiveSettings(
        {
          ...readSettings(),
          blockUnsafeNpmPackages: true,
        },
        null,
      );

      expect(result.blockUnsafeNpmPackages).toBe(true);
    });

    it("falls back to the built-in default when remote config is missing", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({}));

      const result = resolveEffectiveSettings(readSettings(), null);

      expect(result.blockUnsafeNpmPackages).toBe(true);
    });
  });

  describe("getSettingsFilePath", () => {
    it("should return correct settings file path", () => {
      const result = getSettingsFilePath();

      expect(mockGetUserDataPath).toHaveBeenCalled();
      expect(mockPath.join).toHaveBeenCalledWith(
        mockUserDataPath,
        "user-settings.json",
      );
      expect(result).toBe(mockSettingsPath);
    });
  });
});

describe("writeSettings", () => {
  const mockUserDataPath = "/mock/user/data";
  const mockSettingsPath = "/mock/user/data/user-settings.json";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserDataPath.mockReturnValue(mockUserDataPath);
    mockPath.join.mockReturnValue(mockSettingsPath);
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to defaults and shows a restore-docs toast when the existing settings file cannot be read", () => {
    notifyRendererErrorToastListenerReady(mockWebContents);
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue("invalid json");

    writeSettings({ enableAutoUpdate: false });

    expect(mockSend).toHaveBeenCalledWith(
      "toast:error",
      expect.objectContaining({
        action: {
          label: "Read restore docs",
          url: "https://www.dyad.sh/docs/guides/migrate-restore#restoring-settings-from-backup",
        },
        message: expect.not.stringContaining("https://"),
      }),
    );
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\/mock\/user\/data\/user-settings\.json\.tmp-\d+-\d+$/,
      ),
      expect.stringContaining('"enableAutoUpdate": false'),
    );
    expect(mockFs.copyFileSync).toHaveBeenCalledWith(
      mockSettingsPath,
      expect.stringMatching(
        /^\/mock\/user\/data\/user-settings\.json\.recovery-\d+\.bak$/,
      ),
    );
    expect(mockFs.renameSync).toHaveBeenCalled();
  });

  it("writes through a temporary file and backs up the previous settings file", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        providerSettings: {},
        selectedModel: {
          name: "gpt-4",
          provider: "openai",
        },
        selectedTemplateId: "react",
        enableAutoUpdate: true,
        releaseChannel: "stable",
      }),
    );

    writeSettings({ enableAutoUpdate: false });

    const tempFilePath = expect.stringMatching(
      /^\/mock\/user\/data\/user-settings\.json\.tmp-\d+-\d+$/,
    );
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      tempFilePath,
      expect.stringContaining('"enableAutoUpdate": false'),
    );
    expect(mockFs.copyFileSync).toHaveBeenCalledWith(
      mockSettingsPath,
      `${mockSettingsPath}.bak`,
    );
    expect(mockFs.renameSync).toHaveBeenCalledWith(
      tempFilePath,
      mockSettingsPath,
    );
  });

  it("preserves the legacy Build-mode MCP setting across unrelated writes", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        providerSettings: {},
        selectedModel: {
          name: "gpt-4",
          provider: "openai",
        },
        selectedTemplateId: "react",
        enableAutoUpdate: true,
        releaseChannel: "stable",
        enableMcpServersForBuildMode: true,
      }),
    );

    writeSettings({ enableAutoUpdate: false });

    const tempFileWrite = mockFs.writeFileSync.mock.calls.find(([filePath]) =>
      String(filePath).startsWith(`${mockSettingsPath}.tmp-`),
    );
    expect(tempFileWrite).toBeDefined();
    expect(JSON.parse(String(tempFileWrite?.[1]))).toMatchObject({
      enableAutoUpdate: false,
      enableMcpServersForBuildMode: true,
    });
  });

  it("throws a classified error when the settings file cannot be written", () => {
    mockFs.existsSync.mockReturnValue(false);
    mockFs.writeFileSync.mockImplementation(() => {
      throw new Error("disk full");
    });

    let thrown: unknown;
    try {
      writeSettings({ enableAutoUpdate: false });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DyadError);
    expect((thrown as DyadError).kind).toBe(DyadErrorKind.External);
    expect((thrown as DyadError).cause).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(
      "Failed to write settings: disk full",
    );
  });

  it("classifies settings validation failures and preserves the cause", () => {
    mockFs.existsSync.mockReturnValue(false);
    mockFs.writeFileSync.mockImplementation(() => {});

    let thrown: unknown;
    try {
      writeSettings({
        selectedModel: null,
      } as unknown as Partial<UserSettings>);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DyadError);
    expect((thrown as DyadError).kind).toBe(DyadErrorKind.Validation);
    expect((thrown as DyadError).cause).toBeInstanceOf(ZodError);
  });

  it("returns false instead of throwing for best-effort settings writes", () => {
    mockFs.existsSync.mockReturnValue(false);
    mockFs.writeFileSync.mockImplementation(() => {
      throw new Error("disk full");
    });

    expect(
      tryWriteSettings({ enableAutoUpdate: false }, "test best-effort write"),
    ).toBe(false);
  });
});

describe("encrypt", () => {
  it("should trim whitespace before encrypting", () => {
    const result = encrypt("  my-api-key\n");
    // In test builds, encryption falls back to plaintext
    expect(result.value).toBe("my-api-key");
  });

  it("should trim trailing newlines", () => {
    const result = encrypt("sk-abc123\n\n");
    expect(result.value).toBe("sk-abc123");
  });

  it("should not alter values without whitespace", () => {
    const result = encrypt("sk-abc123");
    expect(result.value).toBe("sk-abc123");
  });
});

describe("decrypt", () => {
  it("should trim whitespace from plaintext secrets", () => {
    const result = decrypt({
      value: "  my-api-key\n",
      encryptionType: "plaintext",
    });
    expect(result).toBe("my-api-key");
  });

  it("should trim whitespace from electron-safe-storage secrets", () => {
    mockSafeStorage.decryptString.mockReturnValue("  decrypted-key\n");
    const result = decrypt({
      value: Buffer.from("encrypted").toString("base64"),
      encryptionType: "electron-safe-storage",
    });
    expect(result).toBe("decrypted-key");
  });

  it("should not alter values without whitespace", () => {
    const result = decrypt({
      value: "sk-abc123",
      encryptionType: "plaintext",
    });
    expect(result).toBe("sk-abc123");
  });
});

function scrubSettings(result: UserSettings) {
  return {
    ...result,
    telemetryUserId: "[scrubbed]",
  };
}

describe("preserving undecryptable secrets", () => {
  const mockUserDataPath = "/mock/user/data";
  const mockSettingsPath = "/mock/user/data/user-settings.json";
  let store: Record<string, string>;

  // Marker-based ciphertext: a secret whose plaintext contains "LOCKED" fails to
  // decrypt (simulating a Keychain identity flip); everything else decrypts.
  const b64 = (value: string) => Buffer.from(value).toString("base64");
  const lockedSecret = (marker: string) => ({
    value: b64(`LOCKED-${marker}`),
    encryptionType: "electron-safe-storage" as const,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserDataPath.mockReturnValue(mockUserDataPath);
    mockPath.join.mockReturnValue(mockSettingsPath);
    // Unit tests are not an E2E build, so encrypt() only falls back to plaintext
    // when safeStorage reports encryption unavailable. Keep it unavailable so new
    // values written during these tests land as plaintext (decrypt still routes by
    // encryptionType through the mocked decryptString).
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);

    store = {};
    mockFs.existsSync.mockImplementation((p) => (p as string) in store);
    mockFs.readFileSync.mockImplementation((p) => {
      const value = store[p as string];
      if (value === undefined) {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return value;
    });
    mockFs.writeFileSync.mockImplementation((p, data) => {
      store[p as string] = data as string;
    });
    mockFs.copyFileSync.mockImplementation((src, dest) => {
      store[dest as string] = store[src as string];
    });
    mockFs.renameSync.mockImplementation((oldPath, newPath) => {
      store[newPath as string] = store[oldPath as string];
      delete store[oldPath as string];
    });
    mockFs.unlinkSync.mockImplementation((p) => {
      delete store[p as string];
    });

    mockSafeStorage.decryptString.mockImplementation((buf: Buffer) => {
      const marker = Buffer.from(buf).toString("utf-8");
      if (marker.includes("LOCKED")) {
        throw new Error("decrypt failed: identity mismatch");
      }
      return `decrypted:${marker}`;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const readStoredFile = () =>
    JSON.parse(store[mockSettingsPath]) as Record<string, any>;

  it("hides an undecryptable secret from readSettings but keeps its ciphertext on disk across unrelated writes", () => {
    const locked = lockedSecret("github");
    store[mockSettingsPath] = JSON.stringify({
      telemetryConsent: "opted_in",
      githubAccessToken: locked,
    });

    // Consumer read: the locked secret is absent (UI shows "not connected").
    const read = readSettings();
    expect(read.githubAccessToken).toBeUndefined();
    expect(read.telemetryConsent).toBe("opted_in");

    // An empty write must not destroy the ciphertext.
    writeSettings({});
    expect(readStoredFile().githubAccessToken).toEqual(locked);

    // A write touching an unrelated field (e.g. the performance heartbeat) must
    // not destroy it either.
    writeSettings({ enableAutoUpdate: false });
    const afterUnrelated = readStoredFile();
    expect(afterUnrelated.githubAccessToken).toEqual(locked);
    expect(afterUnrelated.enableAutoUpdate).toBe(false);
  });

  it("recovers the preserved secret automatically once it can be decrypted again", () => {
    const locked = lockedSecret("github");
    store[mockSettingsPath] = JSON.stringify({ githubAccessToken: locked });

    writeSettings({});
    expect(readStoredFile().githubAccessToken).toEqual(locked);

    // A later session whose Keychain identity matches again can decrypt the same
    // untouched ciphertext — no migration, just a normal read.
    mockSafeStorage.decryptString.mockImplementation(
      (buf: Buffer) => `recovered:${Buffer.from(buf).toString("utf-8")}`,
    );
    const read = readSettings();
    expect(read.githubAccessToken?.value).toBe("recovered:LOCKED-github");
  });

  it("replaces a locked secret when the caller provides a new value", () => {
    store[mockSettingsPath] = JSON.stringify({
      githubAccessToken: lockedSecret("github"),
    });

    writeSettings({
      githubAccessToken: {
        value: "brand-new-token",
        encryptionType: "electron-safe-storage",
      },
    });

    // In test builds encrypt() falls back to plaintext; the point is that the new
    // value wins and is written through the normal encryption path.
    expect(readStoredFile().githubAccessToken).toEqual({
      value: "brand-new-token",
      encryptionType: "plaintext",
    });
  });

  it("preserves a locked provider apiKey when a write rebuilds providerSettings without it", () => {
    const locked = lockedSecret("openai");
    store[mockSettingsPath] = JSON.stringify({
      providerSettings: { openai: { apiKey: locked } },
    });

    expect(readSettings().providerSettings.openai?.apiKey).toBeUndefined();

    // Simulate a caller writing back a providerSettings object rebuilt from a
    // readSettings() result: the openai provider is present but its dropped apiKey
    // is missing. The shallow merge replaces the whole providerSettings object.
    writeSettings({
      providerSettings: {
        openai: {},
        anthropic: { apiKey: { value: "sk-ant", encryptionType: "plaintext" } },
      },
    });

    const stored = readStoredFile();
    expect(stored.providerSettings.openai.apiKey).toEqual(locked);
    // A genuinely-new sibling secret is still encrypted normally.
    expect(stored.providerSettings.anthropic.apiKey).toEqual({
      value: "sk-ant",
      encryptionType: "plaintext",
    });
  });

  it("does not resurrect a locked provider apiKey when explicitly cleared", () => {
    store[mockSettingsPath] = JSON.stringify({
      providerSettings: { openai: { apiKey: lockedSecret("openai") } },
    });

    writeSettings({
      providerSettings: {
        openai: { apiKey: undefined },
      },
    });

    expect(readStoredFile().providerSettings.openai.apiKey).toBeUndefined();

    writeSettings({ enableAutoUpdate: false });
    expect(readStoredFile().providerSettings.openai.apiKey).toBeUndefined();
  });

  it("does not resurrect a locked Vertex service account key when explicitly cleared", () => {
    store[mockSettingsPath] = JSON.stringify({
      providerSettings: {
        vertex: {
          projectId: "old-project",
          location: "us-central1",
          serviceAccountKey: lockedSecret("vertex"),
        },
      },
    });

    writeSettings({
      providerSettings: {
        vertex: {
          apiKey: undefined,
          projectId: "new-project",
          location: "us-central1",
          serviceAccountKey: undefined,
        },
      },
    });

    const storedVertex = readStoredFile().providerSettings.vertex;
    expect(storedVertex.serviceAccountKey).toBeUndefined();
    expect(storedVertex.projectId).toBe("new-project");
  });

  it("does not resurrect a locked provider whose provider object is deliberately removed", () => {
    store[mockSettingsPath] = JSON.stringify({
      providerSettings: { openai: { apiKey: lockedSecret("openai") } },
    });

    // The caller rebuilds providerSettings dropping the openai provider entirely.
    writeSettings({
      providerSettings: {
        anthropic: { apiKey: { value: "sk-ant", encryptionType: "plaintext" } },
      },
    });

    expect(readStoredFile().providerSettings.openai).toBeUndefined();
  });

  it("preserves a locked supabase organization access token across an unrelated write", () => {
    const lockedAccess = lockedSecret("supabase-access");
    store[mockSettingsPath] = JSON.stringify({
      supabase: {
        organizations: {
          myorg: {
            accessToken: lockedAccess,
            refreshToken: {
              value: b64("refresh"),
              encryptionType: "electron-safe-storage",
            },
            expiresIn: 3600,
            tokenTimestamp: 123,
          },
        },
      },
    });

    // Consumer read drops the whole org because one token can't be decrypted.
    expect(readSettings().supabase?.organizations).toEqual({});

    // An unrelated write must keep the org and its locked ciphertext verbatim.
    writeSettings({ enableAutoUpdate: false });

    const org = readStoredFile().supabase.organizations.myorg;
    expect(org.accessToken).toEqual(lockedAccess);
    // The sibling token that decrypted fine is re-encrypted (plaintext in tests).
    expect(org.refreshToken).toEqual({
      value: "decrypted:refresh",
      encryptionType: "plaintext",
    });
  });

  it("preserves a locked supabase organization when the organizations map is rebuilt", () => {
    const lockedAccess = lockedSecret("supabase-access");
    store[mockSettingsPath] = JSON.stringify({
      supabase: {
        organizations: {
          myorg: {
            accessToken: lockedAccess,
            refreshToken: {
              value: b64("refresh"),
              encryptionType: "electron-safe-storage",
            },
            expiresIn: 3600,
            tokenTimestamp: 123,
          },
        },
      },
    });

    // Consumer reads hide the locked org, and Supabase handlers rebuild the
    // organizations map from that consumer-facing state when adding/removing orgs.
    expect(readSettings().supabase?.organizations).toEqual({});

    writeSettings({
      supabase: {
        organizations: {
          otherorg: {
            accessToken: { value: "other-access", encryptionType: "plaintext" },
            refreshToken: {
              value: "other-refresh",
              encryptionType: "plaintext",
            },
            expiresIn: 7200,
            tokenTimestamp: 456,
          },
        },
      },
    });

    const organizations = readStoredFile().supabase.organizations;
    expect(organizations.myorg.accessToken).toEqual(lockedAccess);
    expect(organizations.myorg.refreshToken).toEqual({
      value: "decrypted:refresh",
      encryptionType: "plaintext",
    });
    expect(organizations.otherorg.accessToken).toEqual({
      value: "other-access",
      encryptionType: "plaintext",
    });
  });

  it("drops a malformed secret without resetting unrelated settings on write", () => {
    store[mockSettingsPath] = JSON.stringify({
      telemetryConsent: "opted_in",
      providerSettings: {
        openai: {
          apiKey: {
            encryptionType: "plaintext",
          },
        },
      },
    });

    writeSettings({ enableAutoUpdate: false });

    const stored = readStoredFile();
    expect(stored.telemetryConsent).toBe("opted_in");
    expect(stored.enableAutoUpdate).toBe(false);
    expect(stored.providerSettings.openai.apiKey).toBeUndefined();
  });

  it("removes a working secret when the caller explicitly clears it (no resurrection)", () => {
    store[mockSettingsPath] = JSON.stringify({
      githubAccessToken: {
        value: b64("good-token"),
        encryptionType: "electron-safe-storage",
      },
    });

    // The secret decrypts fine, so it is never preserved.
    expect(readSettings().githubAccessToken?.value).toBe(
      "decrypted:good-token",
    );

    writeSettings({ githubAccessToken: undefined });
    expect(readStoredFile().githubAccessToken).toBeUndefined();

    // A subsequent unrelated write must not bring it back.
    writeSettings({ enableAutoUpdate: false });
    expect(readStoredFile().githubAccessToken).toBeUndefined();
  });

  it("preserves multiple locked secrets in a single write", () => {
    const lockedGithub = lockedSecret("github");
    const lockedVercel = lockedSecret("vercel");
    const lockedOpenai = lockedSecret("openai");
    store[mockSettingsPath] = JSON.stringify({
      githubAccessToken: lockedGithub,
      vercelAccessToken: lockedVercel,
      providerSettings: { openai: { apiKey: lockedOpenai } },
    });

    const read = readSettings();
    expect(read.githubAccessToken).toBeUndefined();
    expect(read.vercelAccessToken).toBeUndefined();
    expect(read.providerSettings.openai?.apiKey).toBeUndefined();

    writeSettings({ enableAutoUpdate: false });

    const stored = readStoredFile();
    expect(stored.githubAccessToken).toEqual(lockedGithub);
    expect(stored.vercelAccessToken).toEqual(lockedVercel);
    expect(stored.providerSettings.openai.apiKey).toEqual(lockedOpenai);
  });
});

describe("crash sentinel", () => {
  const mockUserDataPath = "/mock/user/data";
  const sentinelPath = `${mockUserDataPath}/session.lock`;
  let store: Record<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserDataPath.mockReturnValue(mockUserDataPath);
    mockPath.join.mockImplementation((...args: string[]) => args.join("/"));
    store = {};
    mockFs.writeFileSync.mockImplementation((p, data) => {
      store[p as string] = data as string;
    });
    mockFs.readFileSync.mockImplementation((p) => {
      const value = store[p as string];
      if (value === undefined) {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return value;
    });
  });

  it("writeCrashSentinel writes JSON with a timestamp and no active chat", () => {
    writeCrashSentinel();
    const data = readCrashSentinel();
    expect(typeof data?.ts).toBe("number");
    expect(data?.activeChatId).toBeUndefined();
  });

  it("setSentinelActiveChat records the chat id, preserving the timestamp", () => {
    writeCrashSentinel();
    const ts = readCrashSentinel()?.ts;
    setSentinelActiveChat(42);
    const data = readCrashSentinel();
    expect(data?.activeChatId).toBe(42);
    expect(data?.ts).toBe(ts);
  });

  it("readCrashSentinel returns null for the legacy bare-timestamp format", () => {
    store[sentinelPath] = "1700000000000";
    expect(readCrashSentinel()).toBeNull();
  });

  it("readCrashSentinel returns null when the sentinel is missing", () => {
    expect(readCrashSentinel()).toBeNull();
  });

  it("readCrashSentinel returns null when ts is not a number", () => {
    store[sentinelPath] = JSON.stringify({ ts: "nope", activeChatId: 1 });
    expect(readCrashSentinel()).toBeNull();
  });

  it("readCrashSentinel ignores a non-numeric activeChatId", () => {
    store[sentinelPath] = JSON.stringify({ ts: 123, activeChatId: "nope" });
    expect(readCrashSentinel()).toEqual({ ts: 123, activeChatId: undefined });
  });
});

describe("legacy keychain recovery integration", () => {
  const mockUserDataPath = "/mock/user/data";
  const mockSettingsPath = "/mock/user/data/user-settings.json";
  let store: Record<string, string>;
  const mockRecover = vi.mocked(recoverLegacySafeStorageSecret);
  const mockGetRecoveryStats = vi.mocked(getRecoveryStats);

  const b64 = (value: string) => Buffer.from(value).toString("base64");
  const lockedSecret = (marker: string) => ({
    value: b64(`LOCKED-${marker}`),
    encryptionType: "electron-safe-storage" as const,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserDataPath.mockReturnValue(mockUserDataPath);
    mockPath.join.mockReturnValue(mockSettingsPath);
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);
    // Recovery is gated on app readiness; default these tests to ready.
    vi.mocked(app.isReady).mockReturnValue(true);

    store = {};
    mockFs.existsSync.mockImplementation((p) => (p as string) in store);
    mockFs.readFileSync.mockImplementation((p) => {
      const value = store[p as string];
      if (value === undefined) {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return value;
    });
    mockFs.writeFileSync.mockImplementation((p, data) => {
      store[p as string] = data as string;
    });
    mockFs.copyFileSync.mockImplementation((src, dest) => {
      store[dest as string] = store[src as string];
    });
    mockFs.renameSync.mockImplementation((oldPath, newPath) => {
      store[newPath as string] = store[oldPath as string];
      delete store[oldPath as string];
    });
    mockFs.unlinkSync.mockImplementation((p) => {
      delete store[p as string];
    });

    mockSafeStorage.decryptString.mockImplementation((buf: Buffer) => {
      const marker = Buffer.from(buf).toString("utf-8");
      if (marker.includes("LOCKED")) {
        throw new Error("decrypt failed: identity mismatch");
      }
      return `decrypted:${marker}`;
    });
    mockRecover.mockReturnValue(null);
    mockGetRecoveryStats.mockReturnValue({
      attempted: 0,
      recovered: 0,
      failed: 0,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const readStoredFile = () =>
    JSON.parse(store[mockSettingsPath]) as Record<string, any>;

  it("returns the recovered plaintext when safeStorage fails but a legacy identity decrypts", () => {
    const locked = lockedSecret("github");
    store[mockSettingsPath] = JSON.stringify({ githubAccessToken: locked });
    mockRecover.mockReturnValue("gh_recovered_token");

    const settings = readSettings();
    expect(settings.githubAccessToken).toEqual({
      value: "gh_recovered_token",
      encryptionType: "electron-safe-storage",
    });
    expect(mockRecover).toHaveBeenCalledWith(locked.value);
  });

  it("trims recovered plaintext before returning it to consumers", () => {
    const locked = lockedSecret("github");
    store[mockSettingsPath] = JSON.stringify({ githubAccessToken: locked });
    mockRecover.mockReturnValue("  gh_recovered_token\n");

    const settings = readSettings();
    expect(settings.githubAccessToken).toEqual({
      value: "gh_recovered_token",
      encryptionType: "electron-safe-storage",
    });
  });

  it("re-encrypts a recovered secret through the normal write path", () => {
    const locked = lockedSecret("github");
    store[mockSettingsPath] = JSON.stringify({ githubAccessToken: locked });
    mockRecover.mockReturnValue("gh_recovered_token");

    // Any write re-reads the file (recovering the secret) and re-encrypts it
    // under the current session identity. With encryption unavailable in this
    // harness, encrypt() stores the recovered value as plaintext.
    writeSettings({ enableAutoUpdate: false });
    expect(readStoredFile().githubAccessToken).toEqual({
      value: "gh_recovered_token",
      encryptionType: "plaintext",
    });
  });

  it("rewrites settings after Keychain unlock when recovery succeeds", () => {
    const locked = lockedSecret("github");
    store[mockSettingsPath] = JSON.stringify({ githubAccessToken: locked });
    mockRecover.mockReturnValue("gh_recovered_token");
    mockGetRecoveryStats
      .mockReturnValueOnce({ attempted: 1, recovered: 0, failed: 1 })
      .mockReturnValueOnce({ attempted: 2, recovered: 1, failed: 1 });

    expect(rewriteRecoveredSafeStorageSecretsAfterKeychainUnlock()).toBe(1);
    expect(readStoredFile().githubAccessToken).toEqual({
      value: "gh_recovered_token",
      encryptionType: "plaintext",
    });
  });

  it("does not rewrite defaults when unlock recovery hits a later settings parse error", () => {
    const locked = lockedSecret("github");
    const originalStoredSettings = {
      githubAccessToken: locked,
      selectedModel: {},
    };
    store[mockSettingsPath] = JSON.stringify(originalStoredSettings);
    mockRecover.mockReturnValue("gh_recovered_token");
    mockGetRecoveryStats
      .mockReturnValueOnce({ attempted: 1, recovered: 0, failed: 1 })
      .mockReturnValueOnce({ attempted: 2, recovered: 1, failed: 1 });

    expect(rewriteRecoveredSafeStorageSecretsAfterKeychainUnlock()).toBe(0);
    expect(JSON.parse(store[mockSettingsPath])).toEqual(originalStoredSettings);
  });

  it("preserves the ciphertext when recovery also fails", () => {
    const locked = lockedSecret("github");
    store[mockSettingsPath] = JSON.stringify({ githubAccessToken: locked });
    mockRecover.mockReturnValue(null);

    expect(readSettings().githubAccessToken).toBeUndefined();
    writeSettings({ enableAutoUpdate: false });
    expect(readStoredFile().githubAccessToken).toEqual(locked);
  });

  it("does not attempt recovery for plaintext secrets or not-ready errors", () => {
    // Not-ready: the whole read falls back to defaults without recovery.
    store[mockSettingsPath] = JSON.stringify({
      githubAccessToken: lockedSecret("github"),
    });
    mockSafeStorage.decryptString.mockImplementation(() => {
      throw new Error("safeStorage cannot be used before app is ready");
    });
    const settings = readSettings();
    expect(settings.githubAccessToken).toBeUndefined();
    expect(mockRecover).not.toHaveBeenCalled();
  });

  it("does not shell out to recovery before the app is ready", () => {
    // Electron 40 can run safeStorage pre-`ready`, so a decrypt failure can
    // occur before the window exists. Recovery must not fire then (it would
    // block the cold-start path and could raise a Keychain prompt).
    vi.mocked(app.isReady).mockReturnValue(false);
    const locked = lockedSecret("github");
    store[mockSettingsPath] = JSON.stringify({ githubAccessToken: locked });
    mockRecover.mockReturnValue("gh_recovered_token");

    // Pre-ready read: the secret is omitted and recovery is never attempted.
    expect(readSettings().githubAccessToken).toBeUndefined();
    expect(mockRecover).not.toHaveBeenCalled();

    // Pre-ready write still preserves the ciphertext verbatim (never destroyed),
    // so a later post-ready read can recover it.
    writeSettings({ enableAutoUpdate: false });
    expect(mockRecover).not.toHaveBeenCalled();
    expect(readStoredFile().githubAccessToken).toEqual(locked);

    // Once ready, the same stored ciphertext is recovered.
    vi.mocked(app.isReady).mockReturnValue(true);
    expect(readSettings().githubAccessToken).toEqual({
      value: "gh_recovered_token",
      encryptionType: "electron-safe-storage",
    });
    expect(mockRecover).toHaveBeenCalledWith(locked.value);
  });
});

describe("renderer crash record", () => {
  const mockUserDataPath = "/mock/user/data";
  const crashPath = `${mockUserDataPath}/renderer-crash.json`;
  let store: Record<string, string>;

  const performance = {
    timestamp: 1751500000000,
    memoryUsageMB: 400,
    cpuUsagePercent: 12.5,
    systemMemoryUsageMB: 8000,
    systemMemoryTotalMB: 16000,
    systemCpuPercent: 33,
    heapUsedMB: 512,
    heapLimitMB: 4144,
    processWorkingSetsMB: { browser: 400, tab: 900 },
    activity: {
      activeStreams: 1,
      runningApps: 2,
      extractCodebase: true,
      tsUtilityProcess: "tsc" as const,
    },
    peakHeapUsedMB: 1024,
    peakHeapPct: 24.7,
    peakRssMB: 2048,
    peakProcessWorkingSetsMB: { browser: 900, tab: 2000 },
    peakActivity: {
      activeStreams: 2,
      runningApps: 3,
      extractCodebase: false,
      tsUtilityProcess: null,
    },
    peakTimestamp: 1751499970000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserDataPath.mockReturnValue(mockUserDataPath);
    mockPath.join.mockImplementation((...args: string[]) => args.join("/"));
    store = {};
    mockFs.writeFileSync.mockImplementation((p, data) => {
      store[p as string] = data as string;
    });
    mockFs.renameSync.mockImplementation((from, to) => {
      store[to as string] = store[from as string];
      delete store[from as string];
    });
    mockFs.existsSync.mockImplementation(
      (p) => store[p as string] !== undefined,
    );
    mockFs.readFileSync.mockImplementation((p) => {
      const value = store[p as string];
      if (value === undefined) {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return value;
    });
  });

  it("round-trips the full performance block, including memory and peak fields", () => {
    recordRendererCrash({ reason: "oom", exitCode: 1, performance });
    const record = readRendererCrashRecord();
    expect(record?.reason).toBe("oom");
    expect(record?.performance).toEqual(performance);
  });

  it("drops a malformed performance block but keeps the crash record", () => {
    store[crashPath] = JSON.stringify({
      reason: "crashed",
      timestamp: 1751500000000,
      count: 1,
      performance: { timestamp: "not-a-number" },
    });
    const record = readRendererCrashRecord();
    expect(record?.reason).toBe("crashed");
    expect(record?.performance).toBeUndefined();
  });
});
