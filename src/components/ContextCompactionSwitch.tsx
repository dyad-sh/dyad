import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function ContextCompactionSwitch() {
  const { settings, updateSettings } = useSettings();
  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="context-compaction"
        aria-label="Context Compaction"
        checked={settings?.enableContextCompaction !== false}
        onCheckedChange={(checked) => {
          updateSettings({ enableContextCompaction: checked });
        }}
      />
      <Label htmlFor="context-compaction">Context Compaction</Label>
    </div>
  );
}
