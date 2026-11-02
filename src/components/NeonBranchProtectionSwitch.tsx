import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { DEFAULT_ENABLE_NEON_BRANCH_PROTECTION } from "@/shared/settings_defaults";
import { NeonSettingsStatus } from "@/components/NeonSettingsStatus";

export function NeonBranchProtectionSwitch() {
  const { settings, settingsLoading, refreshSettings, updateSettings } =
    useSettings();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {!settings ? (
          <NeonSettingsStatus
            loading={settingsLoading}
            onRetry={refreshSettings}
          />
        ) : (
          <Switch
            id="enable-neon-branch-protection"
            aria-label="Protect Neon database branches"
            checked={
              settings.enableNeonBranchProtection ??
              DEFAULT_ENABLE_NEON_BRANCH_PROTECTION
            }
            onCheckedChange={(checked) => {
              // The settings mutation displays its own error toast.
              void updateSettings({
                enableNeonBranchProtection: checked,
              }).catch(() => {});
            }}
          />
        )}
        <Label htmlFor="enable-neon-branch-protection">
          Protect Neon database branches
        </Label>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Keep development and production databases separate. Disable to allow
        development databases in deployments or production databases while
        building. These choices can expose test data or damage live data.
        Existing selections remain available with warnings.
      </p>
    </div>
  );
}
