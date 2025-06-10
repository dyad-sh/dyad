import { ContextFilesPicker } from "./ContextFilesPicker";
import { ModelPicker } from "./ModelPicker";
import { ProModeSelector } from "./ProModeSelector";

export function ChatInputControls({
  showContextFilesPicker = false,
}: {
  showContextFilesPicker?: boolean;
}) {
  return (
    <div className="pb-2 flex gap-2">
      <ModelPicker />
      {showContextFilesPicker && <ContextFilesPicker />}
      <ProModeSelector />
    </div>
  );
}
