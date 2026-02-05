import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/hooks/useSettings";

export function MemorySwitch() {
  const { settings, updateSettings } = useSettings();

  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="enable-memory"
        aria-label="Enable Memory"
        checked={!!settings?.enableMemory}
        onCheckedChange={(checked) => {
          updateSettings({
            enableMemory: checked,
          });
        }}
      />
      <Label htmlFor="enable-memory">Enable Memory</Label>
    </div>
  );
}
