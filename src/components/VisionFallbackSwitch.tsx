import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function VisionFallbackSwitch() {
  const { settings, updateSettings } = useSettings();
  const enabled = settings?.enableVisionFallback ?? true;

  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="vision-fallback"
        aria-label="Describe images for text-only models"
        checked={enabled}
        onCheckedChange={() => {
          updateSettings({ enableVisionFallback: !enabled });
        }}
      />
      <Label htmlFor="vision-fallback">
        Describe images for text-only models
      </Label>
    </div>
  );
}
