import { ContextFilesPicker } from "./ContextFilesPicker";
import { ModelPicker } from "./ModelPicker";
import { ProModeSelector } from "./ProModeSelector";
import { ChatModeSelector } from "./ChatModeSelector";
import { McpToolsPicker } from "@/components/McpToolsPicker";
import { useSettings } from "@/hooks/useSettings";
import { useMcp } from "@/hooks/useMcp";
import { useChatMode } from "@/hooks/useChatMode";
import { useRouterState } from "@tanstack/react-router";

export function ChatInputControls({
  showContextFilesPicker = false,
}: {
  showContextFilesPicker?: boolean;
}) {
  const { settings } = useSettings();
  const routerState = useRouterState();
  const chatId =
    routerState.location.pathname === "/chat"
      ? (routerState.location.search.id as number | undefined)
      : null;
  const { selectedMode } = useChatMode(chatId);
  const { servers } = useMcp();
  const enabledMcpServersCount = servers.filter((s) => s.enabled).length;

  // Show MCP tools picker when:
  // 1. The enableMcpServersForBuildMode experiment is on AND
  // 2. Mode is "build" AND there are enabled MCP servers
  const showMcpToolsPicker =
    !!settings?.enableMcpServersForBuildMode &&
    selectedMode === "build" &&
    enabledMcpServersCount > 0;

  return (
    <div className="flex items-center">
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
