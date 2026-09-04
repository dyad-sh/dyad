import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { DEFAULT_ENABLE_LOCALHOST_PREVIEW_ISOLATION } from "@/shared/settings_defaults";

export function LocalhostPreviewIsolationSwitch() {
  const { settings, updateSettings } = useSettings();
  const isEnabled =
    settings?.enableLocalhostPreviewIsolation ??
    DEFAULT_ENABLE_LOCALHOST_PREVIEW_ISOLATION;

  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="localhost-preview-isolation"
        aria-label="Isolate local preview data"
        checked={isEnabled}
        disabled={!settings}
        onCheckedChange={(checked) => {
          void updateSettings({
            enableLocalhostPreviewIsolation: checked,
          }).catch(() => {});
        }}
      />
      <Label htmlFor="localhost-preview-isolation">
        Isolate local preview data
      </Label>
    </div>
  );
}
