import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function KeepPreviewsRunningSwitch() {
  const { settings, updateSettings } = useSettings();
  const isEnabled = settings?.previewIdleTimeoutPolicy === "never";

  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="keep-previews-running"
        aria-label="Keep app previews running forever"
        checked={isEnabled}
        onCheckedChange={(checked) => {
          updateSettings({
            previewIdleTimeoutPolicy: checked ? "never" : "default",
          });
        }}
      />
      <Label htmlFor="keep-previews-running">
        Keep app previews running forever
      </Label>
    </div>
  );
}
