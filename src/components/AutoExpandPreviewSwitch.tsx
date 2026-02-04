import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function AutoExpandPreviewSwitch() {
  const { settings, updateSettings } = useSettings();
  const isEnabled = settings?.autoExpandPreviewPanel;

  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="auto-expand-preview"
        aria-label="Auto-expand preview panel"
        checked={isEnabled}
        onCheckedChange={(checked) => {
          updateSettings({
            autoExpandPreviewPanel: checked,
          });
        }}
      />
      <Label htmlFor="auto-expand-preview">Auto-expand preview panel</Label>
    </div>
  );
}
