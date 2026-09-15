import type {
  LargeLanguageModel,
  ModelSelection,
  UserSettings,
} from "@/lib/schemas";
export type ExecutionBackend = "dyad" | "claude-code";

export function executionBackendForModel(
  model?: { provider: string } | null,
): ExecutionBackend {
  return model?.provider === "claude-code" ? "claude-code" : "dyad";
}

export const BACKEND_SWITCH_MESSAGE =
  "Switching backends requires a new chat. Your current chat will stay unchanged.";

export function assistantAttribution(
  backend: ExecutionBackend | null | undefined,
  model: string | null | undefined,
): string {
  return backend === "claude-code"
    ? `Claude Code (${model || "model unavailable"})`
    : model || "";
}

/** Legacy chats must not inherit a default from a different execution backend. */
export function modelForChatBackend(
  chat:
    | {
        executionBackend?: ExecutionBackend | null;
        modelSelection?: ModelSelection | null;
      }
    | null
    | undefined,
  settings:
    | Pick<UserSettings, "selectedModel" | "recentModels">
    | null
    | undefined,
): LargeLanguageModel {
  if (chat?.modelSelection) return chat.modelSelection;
  const selected = settings?.selectedModel ?? {
    provider: "auto",
    name: "auto",
  };
  if (
    !chat ||
    executionBackendForModel(selected) === (chat.executionBackend ?? "dyad")
  )
    return selected;
  return (
    settings?.recentModels?.find(
      (model) =>
        executionBackendForModel(model) === (chat.executionBackend ?? "dyad"),
    ) ??
    (chat.executionBackend === "claude-code"
      ? { provider: "claude-code", name: "sonnet" }
      : { provider: "auto", name: "auto" })
  );
}
