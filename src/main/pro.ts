import { readSettings, writeSettings } from "./settings";

export function handleDyadProReturn({
  apiKey,
  budgetResetAt,
  maxBudget,
}: {
  apiKey: string;
  budgetResetAt: string | null | undefined;
  maxBudget: number | null | undefined;
}) {
  const settings = readSettings();
  writeSettings({
    providerSettings: {
      ...settings.providerSettings,
      auto: {
        ...settings.providerSettings.auto,
        apiKey: {
          value: apiKey,
        },
      },
    },
    dyadProBudget:
      budgetResetAt && maxBudget
        ? {
            budgetResetAt,
            maxBudget,
          }
        : undefined,
    enableDyadPro: true,
  });
}
