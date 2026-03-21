import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { showInfo } from "@/lib/toast";

export function GitAutoCommitSwitch({
  showToast = true,
}: {
  showToast?: boolean;
}) {
  const { settings, updateSettings } = useSettings();

  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="git-auto-commit"
        aria-label="Git auto-commit"
        checked={settings?.enableGitAutoCommit ?? true}
        onCheckedChange={(checked) => {
          updateSettings({
            enableGitAutoCommit: checked,
          });
          if (!checked && showToast) {
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
