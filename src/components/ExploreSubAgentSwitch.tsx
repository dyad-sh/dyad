import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function ExploreSubAgentSwitch() {
  const { settings, updateSettings } = useSettings();
  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="explore-sub-agent"
        aria-label="Explore sub-agent"
        checked={settings?.enableExploreSubAgent}
        onCheckedChange={() => {
          updateSettings({
            enableExploreSubAgent: !settings?.enableExploreSubAgent,
          });
        }}
      />
      <div>
        <Label htmlFor="explore-sub-agent">Explore sub-agent</Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Use a faster model to gather codebase context at the start of new
          chats
        </p>
      </div>
    </div>
  );
}
