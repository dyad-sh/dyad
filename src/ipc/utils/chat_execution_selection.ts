import { readSettings } from "@/main/settings";
import type { ModelSelection, UserSettings } from "@/lib/schemas";
import { executionBackendForModel } from "@/shared/execution_backend";
import { resolveDefaultModelSelection } from "./model_effort";

/** Shared by standalone chat creation and the initial chats of created/imported apps. */
export async function initialChatExecution(
  modelSelection?: ModelSelection,
  settings: UserSettings = readSettings(),
) {
  const selected =
    modelSelection ??
    (settings.selectedModel.provider === "claude-code"
      ? await resolveDefaultModelSelection(settings)
      : undefined);
  return {
    modelSelection: selected,
    executionBackend: executionBackendForModel(selected),
  };
}
