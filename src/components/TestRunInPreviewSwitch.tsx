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
          // Until settings load the switch reads `false` whatever the stored
          // value is, so a click here would send the *opposite* of what the
          // user sees the moment the query resolves.
          disabled={!settings}
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
        open. Each test gets a fresh page and browser session, so cookies and
        stored data do not carry over between tests.
      </p>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Automation uses an authenticated connection opened only for the test run
        and scoped to its isolated preview page.
      </p>
    </div>
  );
}
