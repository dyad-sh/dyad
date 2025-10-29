import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { readSettings, getSettingsFilePath } from "@/main/settings";
import { getUserDataPath } from "@/paths/paths";
import { UserSettings } from "@/lib/schemas";

// Mock dependencies
vi.mock("node:fs");
vi.mock("node:path");
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(),
    decryptString: vi.fn(),
  },
}));
vi.mock("@/paths/paths", () => ({
  getUserDataPath: vi.fn(),
}));

const mockFs = vi.mocked(fs);
const mockPath = vi.mocked(path);
const mockSafeStorage = vi.mocked(safeStorage);
const mockGetUserDataPath = vi.mocked(getUserDataPath);

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
          "enableAutoFixProblems": false,
          "enableAutoUpdate": true,
          "enableProLazyEditsMode": true,
          "enableProSmartFilesContextMode": true,
          "experiments": {},
          "hasRunBefore": false,
          "providerSettings": {},
          "releaseChannel": "stable",
          "selectedChatMode": "build",
          "selectedModel": {
            "name": "auto",
            "provider": "auto",
          },
          "selectedTemplateId": "react",
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
      expect(result.enableAutoUpdate).toBe(true);
      expect(result.releaseChannel).toBe("stable");
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

    it("should strip extra fields not recognized by the schema", () => {
      const mockFileContent = {
        selectedModel: {
          name: "gpt-4",
          provider: "openai",
        },
        telemetryConsent: "opted_in",
        hasRunBefore: true,
        // Extra fields that are not in the schema
        unknownField: "should be removed",
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

      // Extra fields should be stripped by schema validation
      expect(result).not.toHaveProperty("unknownField");
      expect(result).not.toHaveProperty("deprecatedSetting");
      expect(result).not.toHaveProperty("extraConfig");

      // Should still have defaults for missing properties
      expect(result.enableAutoUpdate).toBe(true);
      expect(result.releaseChannel).toBe("stable");
    });
  });

  describe("error handling", () => {
    it("should return default settings when file read fails", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("File read error");
      });

      const result = readSettings();

      expect(scrubSettings(result)).toMatchInlineSnapshot(`
        {
          "enableAutoFixProblems": false,
          "enableAutoUpdate": true,
          "enableProLazyEditsMode": true,
          "enableProSmartFilesContextMode": true,
          "experiments": {},
          "hasRunBefore": false,
          "providerSettings": {},
          "releaseChannel": "stable",
          "selectedChatMode": "build",
          "selectedModel": {
            "name": "auto",
            "provider": "auto",
          },
          "selectedTemplateId": "react",
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

    it("should handle decryption errors gracefully", () => {
      const mockFileContent = {
        githubAccessToken: {
          value: "corrupted-encrypted-data",
          encryptionType: "electron-safe-storage",
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockFileContent));
      mockSafeStorage.decryptString.mockImplementation(() => {
        throw new Error("Decryption failed");
      });

      const result = readSettings();

      expect(result).toMatchObject({
        selectedModel: {
          name: "auto",
          provider: "auto",
        },
        releaseChannel: "stable",
      });
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

function scrubSettings(result: UserSettings) {
  return {
    ...result,
    telemetryUserId: "[scrubbed]",
  };
}
