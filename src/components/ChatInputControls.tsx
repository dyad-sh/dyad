import { ContextFilesPicker } from "./ContextFilesPicker";
import { ModelPicker } from "./ModelPicker";
import { ProModeSelector } from "./ProModeSelector";

export function ChatInputControls({
  showContextFilesPicker = false,
}: {
  showContextFilesPicker?: boolean;
}) {
  return (
    <div className="flex">
      <ModelPicker />
      <div className="w-2"></div>
      <ProModeSelector />
      <div className="w-1"></div>
      {showContextFilesPicker && (
        <>
          <ContextFilesPicker />
          <div className="w-0.5"></div>
        </>
      )}
    </div>
  );
}
