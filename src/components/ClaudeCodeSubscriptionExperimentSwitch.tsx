import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";

export function ClaudeCodeSubscriptionExperimentSwitch() {
  const { settings, updateSettings } = useSettings();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Switch
          id="enable-claude-code-subscription"
          aria-label="Enable Claude Code subscription"
          checked={!!settings?.enableClaudeCodeSubscription}
          onCheckedChange={(checked) => {
            void updateSettings({ enableClaudeCodeSubscription: checked });
          }}
        />
        <Label htmlFor="enable-claude-code-subscription">
          Enable Claude Code subscription
        </Label>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Use the official local Claude Code CLI with your Claude subscription.
        Agent mode with Dyad Pro also uses Dyad credits, like ChatGPT
        subscription. Build, Ask and Plan do not use Dyad credits. Disabling
        this experiment prevents new Claude Code turns; existing chats stay
        unchanged.
      </p>
    </div>
  );
}
