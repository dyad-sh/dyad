import { ContextFilesPicker } from "./ContextFilesPicker";
import { ModelPicker } from "./ModelPicker";
import { ProModeSelector } from "./ProModeSelector";
import { ChatModeSelector } from "./ChatModeSelector";
import { McpToolsPicker } from "@/components/McpToolsPicker";
import { useSettings } from "@/hooks/useSettings";

export function ChatInputControls({
  showContextFilesPicker = false,
}: {
  showContextFilesPicker?: boolean;
}) {
  const { settings } = useSettings();

  return (
    <div className="flex items-center gap-0.5">
      <ChatModeSelector />
      {settings?.selectedChatMode === "agent" && <McpToolsPicker />}
      <ModelPicker />
      <ProModeSelector />
      {showContextFilesPicker && <ContextFilesPicker />}
    </div>
  );
}
