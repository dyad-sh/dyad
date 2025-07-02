import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function AutoFixProblemsSwitch() {
  const { settings, updateSettings } = useSettings();
  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="auto-fix-problems"
        checked={settings?.enableAutoFixProblems}
        onCheckedChange={() => {
          updateSettings({
            enableAutoFixProblems: !settings?.enableAutoFixProblems,
          });
        }}
      />
      <Label htmlFor="auto-fix-problems">Auto-fix problems</Label>
    </div>
  );
}
