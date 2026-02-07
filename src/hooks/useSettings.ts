import { useEffect, useCallback } from "react";
import { useAtom } from "jotai";
import { userSettingsAtom, envVarsAtom } from "@/atoms/appAtoms";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { type UserSettings, hasDyadProKey } from "@/lib/schemas";
import { usePostHog } from "posthog-js/react";
import { useAppVersion } from "./useAppVersion";
import { queryKeys } from "@/lib/queryKeys";

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
  const [, setSettingsAtom] = useAtom(userSettingsAtom);
  const [, setEnvVarsAtom] = useAtom(envVarsAtom);
  const appVersion = useAppVersion();
  const queryClient = useQueryClient();

  // Query for user settings
  const settingsQuery = useQuery({
    queryKey: queryKeys.settings.user,
    queryFn: () => ipc.settings.getUserSettings(),
  });

  // Query for env vars
  const envVarsQuery = useQuery({
    queryKey: queryKeys.settings.envVars,
    queryFn: () => ipc.misc.getEnvVars(),
  });

  // Process telemetry side effects when settings load/change
  useEffect(() => {
    if (settingsQuery.data) {
      processSettingsForTelemetry(settingsQuery.data);
      const isPro = hasDyadProKey(settingsQuery.data);
      posthog.people.set({ isPro });
      if (!isInitialLoad && appVersion) {
        posthog.capture("app:initial-load", {
          isPro,
          appVersion,
        });
        isInitialLoad = true;
      }
      setSettingsAtom(settingsQuery.data);
    }
  }, [settingsQuery.data, appVersion, posthog, setSettingsAtom]);

  // Sync env vars to Jotai atom
  useEffect(() => {
    if (envVarsQuery.data) {
      setEnvVarsAtom(envVarsQuery.data);
    }
  }, [envVarsQuery.data, setEnvVarsAtom]);

  // Mutation for updating settings
  const updateSettingsMutation = useMutation({
    mutationFn: async (newSettings: Partial<UserSettings>) => {
      return ipc.settings.setUserSettings(newSettings);
    },
    onSuccess: (updatedSettings) => {
      queryClient.setQueryData(queryKeys.settings.user, updatedSettings);
      processSettingsForTelemetry(updatedSettings);
      posthog.people.set({ isPro: hasDyadProKey(updatedSettings) });
      setSettingsAtom(updatedSettings);
    },
    meta: { showErrorToast: true },
  });

  const updateSettings = useCallback(
    async (newSettings: Partial<UserSettings>) => {
      return updateSettingsMutation.mutateAsync(newSettings);
    },
    [updateSettingsMutation],
  );

  const refreshSettings = useCallback(() => {
    return queryClient.invalidateQueries({
      queryKey: queryKeys.settings.all,
    });
  }, [queryClient]);

  const loading = settingsQuery.isLoading || envVarsQuery.isLoading;
  const error = settingsQuery.error || envVarsQuery.error || null;

  return {
    settings: settingsQuery.data ?? null,
    envVars: envVarsQuery.data ?? {},
    loading,
    error,
    updateSettings,
    refreshSettings,
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
