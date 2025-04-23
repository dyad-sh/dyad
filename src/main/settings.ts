import fs from "node:fs";
import path from "node:path";
import { getUserDataPath } from "../paths/paths";
import { UserSettingsSchema, type UserSettings, Secret } from "../lib/schemas";
import { safeStorage } from "electron";
import { v4 as uuidv4 } from "uuid";

// IF YOU NEED TO UPDATE THIS, YOU'RE PROBABLY DOING SOMETHING WRONG!
// Need to maintain backwards compatibility!
const DEFAULT_SETTINGS: UserSettings = {
  selectedModel: {
    name: "auto",
    provider: "auto",
  },
  providerSettings: {},
  telemetryConsent: "unset",
  telemetryUserId: uuidv4(),
  hasRunBefore: false,
  experiments: {
    enableSupabaseIntegration: false,
  },
};

const SETTINGS_FILE = "user-settings.json";

function getSettingsFilePath(): string {
  return path.join(getUserDataPath(), SETTINGS_FILE);
}

export function readSettings(): UserSettings {
  try {
    const filePath = getSettingsFilePath();
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(DEFAULT_SETTINGS, null, 2));
      return DEFAULT_SETTINGS;
    }
    const rawSettings = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const combinedSettings: UserSettings = {
      ...DEFAULT_SETTINGS,
      ...rawSettings,
    };
    const supabase = combinedSettings.supabase;
    if (supabase) {
      if (supabase.refreshToken) {
        const encryptionType = supabase.refreshToken.encryptionType;
        if (encryptionType) {
          supabase.refreshToken = {
            value: decrypt(supabase.refreshToken),
            encryptionType,
          };
        }
      }
      if (supabase.accessToken) {
        const encryptionType = supabase.accessToken.encryptionType;
        if (encryptionType) {
          supabase.accessToken = {
            value: decrypt(supabase.accessToken),
            encryptionType,
          };
        }
      }
    }
    if (combinedSettings.githubAccessToken) {
      const encryptionType = combinedSettings.githubAccessToken.encryptionType;
      combinedSettings.githubAccessToken = {
        value: decrypt(combinedSettings.githubAccessToken),
        encryptionType,
      };
    }
    for (const provider in combinedSettings.providerSettings) {
      if (combinedSettings.providerSettings[provider].apiKey) {
        const encryptionType =
          combinedSettings.providerSettings[provider].apiKey.encryptionType;
        combinedSettings.providerSettings[provider].apiKey = {
          value: decrypt(combinedSettings.providerSettings[provider].apiKey),
          encryptionType,
        };
      }
    }

    // Validate and merge with defaults
    const validatedSettings = UserSettingsSchema.parse(combinedSettings);

    return validatedSettings;
  } catch (error) {
    console.error("Error reading settings:", error);
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(settings: Partial<UserSettings>): void {
  try {
    const filePath = getSettingsFilePath();
    const currentSettings = readSettings();
    const newSettings = { ...currentSettings, ...settings };
    if (newSettings.githubAccessToken) {
      newSettings.githubAccessToken = encrypt(
        newSettings.githubAccessToken.value
      );
    }
    if (newSettings.supabase) {
      if (newSettings.supabase.accessToken) {
        newSettings.supabase.accessToken = encrypt(
          newSettings.supabase.accessToken.value
        );
      }
      if (newSettings.supabase.refreshToken) {
        newSettings.supabase.refreshToken = encrypt(
          newSettings.supabase.refreshToken.value
        );
      }
    }
    for (const provider in newSettings.providerSettings) {
      if (newSettings.providerSettings[provider].apiKey) {
        newSettings.providerSettings[provider].apiKey = encrypt(
          newSettings.providerSettings[provider].apiKey.value
        );
      }
    }
    const validatedSettings = UserSettingsSchema.parse(newSettings);
    fs.writeFileSync(filePath, JSON.stringify(validatedSettings, null, 2));
  } catch (error) {
    console.error("Error writing settings:", error);
  }
}

export function encrypt(data: string): Secret {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      value: safeStorage.encryptString(data).toString("base64"),
      encryptionType: "electron-safe-storage",
    };
  }
  return {
    value: data,
    encryptionType: "plaintext",
  };
}

export function decrypt(data: Secret): string {
  if (data.encryptionType === "electron-safe-storage") {
    return safeStorage.decryptString(Buffer.from(data.value, "base64"));
  }
  return data.value;
}
