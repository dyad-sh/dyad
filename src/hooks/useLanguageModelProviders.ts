import { useQuery } from "@tanstack/react-query";
import { ipc, type LanguageModelProvider } from "@/ipc/types";
import { useSettings } from "./useSettings";
import { cloudProviders, isDyadProEnabled } from "@/lib/schemas";
import { queryKeys } from "@/lib/queryKeys";
import { isProviderSetup as isProviderSetupUtil } from "@/lib/providerUtils";
import { useSubscriptionAccount } from "./useSubscriptionAccount";
import {
  isChatGPTAutoSelection,
  usesChatGPTSubscription,
} from "@/lib/subscriptionModels";

const localProviders = new Set(["ollama", "lmstudio"]);

export function useLanguageModelProviders() {
  const { settings, envVars } = useSettings();
  const subscription = useSubscriptionAccount();

  const queryResult = useQuery<LanguageModelProvider[], Error>({
    queryKey: queryKeys.languageModels.providers,
    queryFn: async () => {
      return ipc.languageModel.getProviders();
    },
  });

  const isProviderSetup = (provider: string) => {
    return isProviderSetupUtil(provider, {
      settings,
      envVars,
      providerData: queryResult.data,
      isLoading: queryResult.isLoading,
    });
  };

  const isAnyProviderSetup = () => {
    if (
      settings &&
      !subscription.data?.pending &&
      !subscription.data?.setupError &&
      (usesChatGPTSubscription(
        settings.selectedModel,
        settings,
        subscription.data ?? { connected: false, models: [] },
      ) ||
        (!isDyadProEnabled(settings) &&
          settings.proModelUsage !== "pro" &&
          settings.proModelUsage !== "api-key" &&
          isChatGPTAutoSelection(settings.selectedModel) &&
          subscription.data?.connected &&
          subscription.data.models.length > 0))
    )
      return true;
    if (
      settings?.selectedModel.provider &&
      localProviders.has(settings.selectedModel.provider) &&
      settings.selectedModel.name.trim()
    ) {
      return true;
    }

    // Check hardcoded cloud providers
    if (cloudProviders.some((provider) => isProviderSetup(provider))) {
      return true;
    }

    // Check custom providers
    const customProviders = queryResult.data?.filter(
      (provider) => provider.type === "custom",
    );
    return (
      customProviders?.some((provider) => isProviderSetup(provider.id)) ?? false
    );
  };

  return {
    ...queryResult,
    isLoading: queryResult.isLoading || subscription.isLoading,
    isProviderSetup,
    isAnyProviderSetup,
  };
}
