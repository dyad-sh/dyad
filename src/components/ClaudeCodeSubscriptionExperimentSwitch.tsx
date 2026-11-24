import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { SETTING_IDS } from "@/lib/settingsSearchIndex";

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
      <div
        id={SETTING_IDS.enableClaudeCodeNativeTools}
        className="ml-6 space-y-1.5 border-l pl-3"
      >
        <div className="flex items-center gap-2">
          <Switch
            id="enable-claude-code-native-tools"
            aria-label="Use native Claude Code tools"
            checked={
              !!settings?.enableClaudeCodeSubscription &&
              !!settings.enableClaudeCodeNativeTools
            }
            disabled={!settings?.enableClaudeCodeSubscription}
            onCheckedChange={(checked) => {
              void updateSettings({ enableClaudeCodeNativeTools: checked });
            }}
          />
          <Label htmlFor="enable-claude-code-native-tools">
            Use native Claude Code tools (including Bash)
          </Label>
        </div>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          In Agent mode, Claude Code uses its own tools and your Claude Code
          setup (CLAUDE.md, skills, plugins, hooks and MCP servers). Bash
          commands run on your machine, approved by Claude Code&apos;s auto
          mode. Ask, Plan and Build, and apps that run in Docker or Dyad Cloud,
          keep using Dyad&apos;s tools. Requires the Claude Code subscription
          experiment.
        </p>
      </div>
    </div>
  );
}
