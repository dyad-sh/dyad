import { ModelPicker } from "./ModelPicker";
import { ProModeSelector } from "./ProModeSelector";
import { ChatModeSelector } from "./ChatModeSelector";

export function ChatInputControls() {
  return (
    <div className="flex min-w-0 items-center">
      <ChatModeSelector />
      <div className="w-1.5 shrink-0"></div>
      <ModelPicker />
      <ProModeSelector />
    </div>
  );
}
