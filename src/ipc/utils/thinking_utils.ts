import { PROVIDERS_THAT_SUPPORT_THINKING } from "../shared/language_model_helpers";

export function getExtraProviderOptions(
  providerId: string | undefined,
): Record<string, any> {
  if (!providerId) {
    return {};
  }
  if (PROVIDERS_THAT_SUPPORT_THINKING.includes(providerId)) {
    return {
      thinking: {
        type: "enabled",
        include_thoughts: true,
      },
    };
  }
  return {};
}
