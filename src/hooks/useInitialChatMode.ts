import { useMemo } from "react";

import { getEffectiveDefaultChatMode, type ChatMode } from "@/lib/schemas";
import { useFreeAgentQuota } from "./useFreeAgentQuota";
import { useSettings } from "./useSettings";

export function useInitialChatMode(): ChatMode | undefined {
  const { settings, envVars } = useSettings();
  const { quotaStatus } = useFreeAgentQuota();

  return useMemo(() => {
    if (!settings) {
      return undefined;
    }

    return getEffectiveDefaultChatMode(
      settings,
      envVars,
      quotaStatus ? !quotaStatus.isQuotaExceeded : undefined,
    );
  }, [envVars, quotaStatus, settings]);
}
