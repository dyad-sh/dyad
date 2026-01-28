import { useSettings } from "@/hooks/useSettings";
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
  const { settings, updateSettings } = useSettings();

  if (!settings) {
    return null;
  }

  const isProEnabled = isDyadProEnabled(settings);
  const effectiveDefault = getEffectiveDefaultChatMode(settings);

  const handleDefaultChatModeChange = (value: ChatMode) => {
    updateSettings({ defaultChatMode: value });
  };

  const getModeDisplayName = (mode: ChatMode) => {
    switch (mode) {
      case "build":
        return "Build";
      case "local-agent":
        return "Agent";
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
          onValueChange={handleDefaultChatModeChange}
        >
          <SelectTrigger className="w-40" id="default-chat-mode">
            <SelectValue>{getModeDisplayName(effectiveDefault)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {isProEnabled && (
              <SelectItem value="local-agent">
                <div className="flex flex-col items-start">
                  <span className="font-medium">Agent</span>
                  <span className="text-xs text-muted-foreground">
                    Better at bigger tasks
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
          </SelectContent>
        </Select>
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        The chat mode used when creating new chats.
      </div>
    </div>
  );
}
