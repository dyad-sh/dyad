import { useEffect, useRef } from "react";
import { useAtomValue } from "jotai";

import { hasManuallySelectedChatModeAtom } from "@/atoms/chatAtoms";
import { getHomeDefaultChatMode } from "@/lib/homeChatMode";
import { isDyadProEnabled } from "@/lib/schemas";
import { useFreeAgentQuota } from "./useFreeAgentQuota";
import { useLanguageModelProviders } from "./useLanguageModelProviders";
import { useSettings } from "./useSettings";

export function useSyncDefaultChatMode(): void {
  const { settings, envVars, updateSettings } = useSettings();
  const { quotaStatus } = useFreeAgentQuota();
  const { isAnyProviderSetup, isLoading: providersLoading } =
    useLanguageModelProviders();
  const hasConfiguredProvider = !providersLoading && isAnyProviderSetup();
  const hasManuallySelectedChatMode = useAtomValue(
    hasManuallySelectedChatModeAtom,
  );
  const updateInFlightRef = useRef(false);

  useEffect(() => {
    if (
      !settings ||
      providersLoading ||
      hasManuallySelectedChatMode ||
      settings.selectedChatMode !== "build"
    ) {
      return;
    }

    const isPro = isDyadProEnabled(settings);
    const hasResolvedQuota = isPro || quotaStatus !== undefined;
    if (
      !hasConfiguredProvider ||
      !hasResolvedQuota ||
      updateInFlightRef.current
    ) {
      return;
    }

    const effectiveDefault = getHomeDefaultChatMode(
      settings,
      envVars,
      quotaStatus ? !quotaStatus.isQuotaExceeded : undefined,
    );
    if (effectiveDefault === "local-agent") {
      updateInFlightRef.current = true;
      void updateSettings({ selectedChatMode: effectiveDefault })
        .catch((error: unknown) => {
          console.warn("Failed to sync the default chat mode", error);
        })
        .finally(() => {
          updateInFlightRef.current = false;
        });
    }
  }, [
    envVars,
    hasConfiguredProvider,
    hasManuallySelectedChatMode,
    providersLoading,
    quotaStatus,
    settings,
    updateSettings,
  ]);
}
