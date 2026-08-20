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
            // The mutation surfaces its own error toast; swallowing the
            // rejection here keeps it from becoming an unhandled rejection.
            void updateSettings({ enableTestRunInPreview: checked }).catch(
              () => {},
            );
          }}
        />
        <Label htmlFor="enable-test-run-in-preview">
          Run tests in preview panel
        </Label>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Sends the Tests panel's headed runs to a native browser view inside the
        preview panel instead of a separate window, so you can watch them run in
        place. The view lasts for the run only: component selection, the visual
        editor, the annotator, and console capture are unavailable while it is
        open. Tests in a preview run share one browser page, so cookies and
        stored data carry over between them unless a test clears them. Dyad must
        be restarted for this setting to take effect.
      </p>
      <p className="text-[13px] leading-relaxed text-amber-700 dark:text-amber-500">
        While enabled, Dyad opens a debugging port on 127.0.0.1 for the whole
        session — not just while tests run — and any program on this machine
        that finds it can control the app. Only enable this on a machine you
        trust, and turn it off when you're done.
      </p>
    </div>
  );
}
