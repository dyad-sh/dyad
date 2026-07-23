import { useEffect } from "react";
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
  const hasManuallySelectedChatMode = useAtomValue(
    hasManuallySelectedChatModeAtom,
  );

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
    const hasConfiguredProvider = isAnyProviderSetup();
    const hasResolvedQuota = isPro || quotaStatus !== undefined;
    if (!hasConfiguredProvider || !hasResolvedQuota) {
      return;
    }

    const effectiveDefault = getHomeDefaultChatMode(
      settings,
      envVars,
      quotaStatus ? !quotaStatus.isQuotaExceeded : undefined,
    );
    if (effectiveDefault === "local-agent") {
      void updateSettings({ selectedChatMode: effectiveDefault });
    }
  }, [
    envVars,
    hasManuallySelectedChatMode,
    isAnyProviderSetup,
    providersLoading,
    quotaStatus,
    settings,
    updateSettings,
  ]);
}
