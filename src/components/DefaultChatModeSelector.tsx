import { useSettings } from "@/hooks/useSettings";
import { useFreeAgentQuota } from "@/hooks/useFreeAgentQuota";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChatMode } from "@/lib/schemas";
import { isDyadProEnabled, getEffectiveDefaultChatMode } from "@/lib/schemas";

export function DefaultChatModeSelector() {
  const { settings, updateSettings, envVars } = useSettings();
  const { isQuotaExceeded, isLoading: isQuotaLoading } = useFreeAgentQuota();

  if (!settings) {
    return null;
  }

  const isProEnabled = isDyadProEnabled(settings);
  // Wait for quota status to load before determining effective default
  const freeAgentQuotaAvailable = !isQuotaLoading && !isQuotaExceeded;
  const effectiveDefault = getEffectiveDefaultChatMode(
    settings,
    envVars,
    freeAgentQuotaAvailable,
  );
  // Show Basic Agent option if user is Pro OR if they have free quota available
  const showBasicAgentOption = isProEnabled || freeAgentQuotaAvailable;

  const handleDefaultChatModeChange = (value: ChatMode) => {
    updateSettings({ defaultChatMode: value });
  };

  const getModeDisplayName = (mode: ChatMode) => {
    switch (mode) {
      case "build":
        return "Build";
      case "agent":
        return "Build (MCP)";
      case "local-agent":
        return isProEnabled ? "Agent" : "Basic Agent";
      case "ask":
      default:
        throw new Error(`Unknown chat mode: ${mode}`);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center space-x-2">
        <label
          htmlFor="default-chat-mode"
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Default Chat Mode
        </label>
        <Select
          value={effectiveDefault}
          onValueChange={(v) => v && handleDefaultChatModeChange(v)}
        >
          <SelectTrigger className="w-40" id="default-chat-mode">
            <SelectValue>{getModeDisplayName(effectiveDefault)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {showBasicAgentOption && (
              <SelectItem value="local-agent">
                <div className="flex flex-col items-start">
                  <span className="font-medium">
                    {isProEnabled ? "Agent" : "Basic Agent"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {isProEnabled
                      ? "Better at bigger tasks"
                      : "Free tier (5 messages/day)"}
                  </span>
                </div>
              </SelectItem>
            )}
            <SelectItem value="build">
              <div className="flex flex-col items-start">
                <span className="font-medium">Build</span>
                <span className="text-xs text-muted-foreground">
                  Generate and edit code
                </span>
              </div>
            </SelectItem>
            <SelectItem value="agent">
              <div className="flex flex-col items-start">
                <span className="font-medium">Build with MCP</span>
                <span className="text-xs text-muted-foreground">
                  Build with tools (MCP)
                </span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        The chat mode used when creating new chats.
      </div>
    </div>
  );
}
