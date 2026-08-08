import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useSettingsDraftContext } from "@/contexts/SettingsDraftContext";
import type { SettingsTabId } from "@/lib/settingsTabs";

type SettingsTabSaveBarProps = {
  tabId: SettingsTabId;
};

export function SettingsTabSaveBar({ tabId }: SettingsTabSaveBarProps) {
  const { t } = useTranslation("settings");
  const draft = useSettingsDraftContext();

  if (!draft?.isTabDirty(tabId)) {
    return null;
  }

  return (
    <div
      className="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200/80 bg-amber-50/95 px-4 py-3 shadow-sm backdrop-blur-sm dark:border-amber-900/60 dark:bg-amber-950/90"
      data-testid={`settings-tab-save-bar-${tabId}`}
    >
      <p className="text-sm text-amber-900 dark:text-amber-100">
        {t("unsavedChanges.message")}
      </p>
      <div className="flex shrink-0 gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={draft.isSaving}
          onClick={() => draft.discardTab(tabId)}
        >
          {t("unsavedChanges.discard")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={draft.isSaving}
          onClick={() => void draft.saveTab(tabId)}
        >
          {draft.isSaving
            ? t("unsavedChanges.saving")
            : t("unsavedChanges.save")}
        </Button>
      </div>
    </div>
  );
}
