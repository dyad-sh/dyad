import { ContextFilesPicker } from "./ContextFilesPicker";
import { ModelPicker } from "./ModelPicker";
import { ProModeSelector } from "./ProModeSelector";
import { ChatModeSelector } from "./ChatModeSelector";
import { McpToolsPicker } from "@/components/McpToolsPicker";
import { useSettings } from "@/hooks/useSettings";
import { useMcp } from "@/hooks/useMcp";

export function ChatInputControls({
  showContextFilesPicker = false,
}: {
  showContextFilesPicker?: boolean;
}) {
  const { settings } = useSettings();
  const { servers } = useMcp();
  const enabledMcpServersCount = servers.filter((s) => s.enabled).length;

  // Show MCP tools picker when:
  // 1. Mode is "agent" (backwards compatibility) OR
  // 2. Mode is "build" AND there are enabled MCP servers
  const showMcpToolsPicker =
    settings?.selectedChatMode === "agent" ||
    (settings?.selectedChatMode === "build" && enabledMcpServersCount > 0);

  return (
    <div className="flex items-center gap-0.5">
      <ChatModeSelector />
      {showMcpToolsPicker && (
        <>
          <div className="w-1.5"></div>
          <McpToolsPicker />
        </>
      )}
      <div className="w-1.5"></div>
      <ModelPicker />
      <ProModeSelector />
      {showContextFilesPicker && <ContextFilesPicker />}
    </div>
  );
}
