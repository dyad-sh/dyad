import { useEffect } from "react";
import { useUserBudgetInfo } from "./useUserBudgetInfo";
import { useSettings } from "./useSettings";

const AUTO_MODEL = { name: "auto", provider: "auto" };

export function useTrialModelRestriction() {
  const { userBudget, isLoadingUserBudget } = useUserBudgetInfo();
  const { settings, updateSettings } = useSettings();

  const isTrial = userBudget?.isTrial ?? false;
  const isOnAutoModel =
    settings?.selectedModel?.provider === "auto" &&
    settings?.selectedModel?.name === "auto";

  // Auto-switch to auto model if user is on trial and not already on auto
  useEffect(() => {
    if (isTrial && settings && !isOnAutoModel && !isLoadingUserBudget) {
      updateSettings({ selectedModel: AUTO_MODEL });
    }
  }, [isTrial, isOnAutoModel, isLoadingUserBudget, settings, updateSettings]);

  return {
    isTrial,
    isLoadingTrialStatus: isLoadingUserBudget,
  };
}
