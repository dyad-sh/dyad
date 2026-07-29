import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";

export function MultiWindowExperimentSwitch() {
  const { settings, updateSettings } = useSettings();

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Switch
          id="enable-multi-window"
          aria-label="Enable multiple windows"
          checked={!!settings?.enableMultiWindow}
          onCheckedChange={(checked) => {
            void updateSettings({ enableMultiWindow: checked });
          }}
        />
        <Label htmlFor="enable-multi-window">Enable multiple windows</Label>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Show the experimental &quot;Open in New Window&quot; action in app
        context menus.
      </p>
    </div>
  );
}
