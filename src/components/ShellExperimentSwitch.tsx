import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { isDyadProEnabled } from "@/lib/schemas";

export function ShellExperimentSwitch() {
  const { settings, updateSettings } = useSettings();
  const isPro = !!settings && isDyadProEnabled(settings);
  return (
    <div className="space-y-1">
      <div className="flex items-center space-x-2">
        <Switch
          id="enable-shell-tool"
          aria-label="Shell tool (Pro)"
          checked={!!settings?.enableShellTool}
          disabled={!isPro}
          onCheckedChange={(checked) =>
            updateSettings({ enableShellTool: checked })
          }
        />
        <Label htmlFor="enable-shell-tool">Shell tool (Pro)</Label>
      </div>
      <div className="text-sm text-muted-foreground">
        Allow Agent mode to run Bash on macOS/Linux or PowerShell on Windows for
        app tasks and connected cloud services. Every command is reviewed using
        Pro credits. Consequential commands may require your approval; clear
        safety violations are blocked. Commands run on your machine without
        filesystem isolation. Available only with the Host runtime.
      </div>
    </div>
  );
}
