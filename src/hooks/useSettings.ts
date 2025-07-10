import { useState, useEffect, useCallback } from "react";
import { useAtom } from "jotai";
import { userSettingsAtom, envVarsAtom } from "@/atoms/appAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import { type UserSettings } from "@/lib/schemas";
import { usePostHog } from "posthog-js/react";
import { useAppVersion } from "./useAppVersion";

const TELEMETRY_CONSENT_KEY = "dyadTelemetryConsent";
const TELEMETRY_USER_ID_KEY = "dyadTelemetryUserId";

export function isTelemetryOptedIn() {
  return window.localStorage.getItem(TELEMETRY_CONSENT_KEY) === "opted_in";
}

export function getTelemetryUserId(): string | null {
  return window.localStorage.getItem(TELEMETRY_USER_ID_KEY);
}

let isInitialLoad = false;

export function useSettings() {
  const posthog = usePostHog();
  const [settings, setSettingsAtom] = useAtom(userSettingsAtom);
  const [envVars, setEnvVarsAtom] = useAtom(envVarsAtom);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const appVersion = useAppVersion();
  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const ipcClient = IpcClient.getInstance();
      // Fetch settings and env vars concurrently
      const [userSettings, fetchedEnvVars] = await Promise.all([
        ipcClient.getUserSettings(),
        ipcClient.getEnvVars(),
      ]);
      processSettingsForTelemetry(userSettings);
      if (!isInitialLoad && appVersion) {
        posthog.capture("app:initial-load", {
          isPro: Boolean(userSettings.providerSettings?.auto?.apiKey?.value),
          appVersion,
        });
        isInitialLoad = true;
      }
      setSettingsAtom(userSettings);
      setEnvVarsAtom(fetchedEnvVars);
      setError(null);
    } catch (error) {
      console.error("Error loading initial data:", error);
      setError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setLoading(false);
    }
  }, [setSettingsAtom, setEnvVarsAtom, appVersion]);

  useEffect(() => {
    // Only run once on mount, dependencies are stable getters/setters
    loadInitialData();
  }, [loadInitialData]);

  const updateSettings = async (newSettings: Partial<UserSettings>) => {
    setLoading(true);
    try {
      const ipcClient = IpcClient.getInstance();
      const updatedSettings = await ipcClient.setUserSettings(newSettings);
      setSettingsAtom(updatedSettings);
      processSettingsForTelemetry(updatedSettings);

      setError(null);
      return updatedSettings;
    } catch (error) {
      console.error("Error updating settings:", error);
      setError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      setLoading(false);
    }
  };

  return {
    settings,
    envVars,
    loading,
    error,
    updateSettings,

    refreshSettings: () => {
      return loadInitialData();
    },
  };
}

function processSettingsForTelemetry(settings: UserSettings) {
  if (settings.telemetryConsent) {
    window.localStorage.setItem(
      TELEMETRY_CONSENT_KEY,
      settings.telemetryConsent,
    );
  } else {
    window.localStorage.removeItem(TELEMETRY_CONSENT_KEY);
  }
  if (settings.telemetryUserId) {
    window.localStorage.setItem(
      TELEMETRY_USER_ID_KEY,
      settings.telemetryUserId,
    );
  } else {
    window.localStorage.removeItem(TELEMETRY_USER_ID_KEY);
  }
}
