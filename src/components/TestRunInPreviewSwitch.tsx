import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";

export function TestRunInPreviewSwitch() {
  const { settings, updateSettings } = useSettings();

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Switch
          id="enable-test-run-in-preview"
          aria-label="Run tests in preview panel"
          checked={!!settings?.enableTestRunInPreview}
          onCheckedChange={(checked) => {
            void updateSettings({ enableTestRunInPreview: checked });
          }}
        />
        <Label htmlFor="enable-test-run-in-preview">
          Run tests in preview panel
        </Label>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Adds a "Run in preview" action to the Tests panel that drives your app's
        tests in a native browser view inside the preview panel, so you can
        watch them run. The view lasts for the run only: component selection,
        the visual editor, the annotator, and console capture are unavailable
        while it is open. Dyad must be restarted for this setting to take
        effect.
      </p>
      <p className="text-[13px] leading-relaxed text-amber-700 dark:text-amber-500">
        While enabled, Dyad opens a debugging port on 127.0.0.1 that can control
        the app. Only enable this on a machine you trust.
      </p>
    </div>
  );
}
