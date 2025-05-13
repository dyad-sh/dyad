import { ModelPicker } from "./ModelPicker";
import { ProModeSelector } from "./ProModeSelector";

export function ChatInputControls() {
  return (
    <div className="pb-2 flex gap-2">
      <ModelPicker />
      <ProModeSelector />
    </div>
  );
}
