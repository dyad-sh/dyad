import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";

export function AutoApproveMcpSwitch() {
  const { settings, updateSettings } = useSettings();
  const isEnabled = !!settings?.autoApproveSafeMcpTools;

  return (
    <div className="space-y-1">
      <div className="flex items-center space-x-2">
        <Switch
          id="enable-auto-approve-safe-mcp-tools"
          aria-label="Skip consent for safe MCP tools"
          checked={isEnabled}
          onCheckedChange={(checked) => {
            updateSettings({
              autoApproveSafeMcpTools: checked,
            });
          }}
        />
        <Label htmlFor="enable-auto-approve-safe-mcp-tools">
          Skip consent for safe MCP tools (Pro)
        </Label>
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        In Agent mode, use a fast model to judge each MCP tool call and skip the
        consent prompt for ones that look safe. Risky actions (deleting data,
        sending messages, changing access) still ask.
      </div>
    </div>
  );
}
