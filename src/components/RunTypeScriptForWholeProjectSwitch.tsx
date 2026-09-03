import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { SETTING_IDS } from "@/lib/settingsSearchIndex";

export function RunTypeScriptForWholeProjectSwitch() {
  const { settings, updateSettings } = useSettings();

  return (
    <div id={SETTING_IDS.runTypeScriptForWholeProject} className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Switch
          id="run-typescript-for-whole-project"
          aria-label="Run TypeScript for whole project"
          checked={!!settings?.runTypeScriptForWholeProject}
          onCheckedChange={(checked) => {
            void updateSettings({ runTypeScriptForWholeProject: checked });
          }}
        />
        <Label htmlFor="run-typescript-for-whole-project">
          Run TypeScript for whole project
        </Label>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Make the local agent&apos;s type-check tool always report diagnostics
        for the whole project instead of selected paths.
      </p>
    </div>
  );
}
