import { useQuery } from "@tanstack/react-query";
import { ipc, type LanguageModelProvider } from "@/ipc/types";
import { useSettings } from "./useSettings";
import { cloudProviders } from "@/lib/schemas";
import { queryKeys } from "@/lib/queryKeys";
import { isProviderSetup as isProviderSetupUtil } from "@/lib/providerUtils";

export function useLanguageModelProviders() {
  const { settings, envVars } = useSettings();

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
    isProviderSetup,
    isAnyProviderSetup,
  };
}
