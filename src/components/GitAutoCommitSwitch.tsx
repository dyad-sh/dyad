import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { showInfo } from "@/lib/toast";
import { useTranslation } from "react-i18next";

export function GitAutoCommitSwitch({
  showToast = true,
}: {
  showToast?: boolean;
}) {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");

  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="git-auto-commit"
        aria-label="Git auto-commit"
        checked={settings?.enableGitAutoCommit ?? true}
        onCheckedChange={() => {
          updateSettings({
            enableGitAutoCommit: !(settings?.enableGitAutoCommit ?? true),
          });
          if ((settings?.enableGitAutoCommit ?? true) && showToast) {
            showInfo(
              "Auto-commit disabled. You can re-enable it in Settings.",
            );
          }
        }}
      />
      <Label htmlFor="git-auto-commit">Git Auto-Commit</Label>
    </div>
  );
}
