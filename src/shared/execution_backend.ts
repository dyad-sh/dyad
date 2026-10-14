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

/** Empty chats may switch in place; populated chats retain their backend. */
export function requiresNewChatForModel(
  chat: {
    executionBackend?: ExecutionBackend | null;
    messages: readonly unknown[];
  },
  model: { provider: string },
): boolean {
  return (
    chat.messages.length > 0 &&
    executionBackendForModel(model) !== (chat.executionBackend ?? "dyad")
  );
}

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
    | Pick<
        UserSettings,
        "selectedModel" | "recentModels" | "enableClaudeCodeSubscription"
      >
    | null
    | undefined,
): LargeLanguageModel {
  if (chat?.modelSelection) return chat.modelSelection;
  const selected = settings?.selectedModel ?? {
    provider: "auto",
    name: "auto",
  };
  // Disabling the experiment preserves existing chats, but must not strand
  // newly created chats on the now-disabled remembered global selection.
  if (
    !chat &&
    selected.provider === "claude-code" &&
    !settings?.enableClaudeCodeSubscription
  )
    return (
      settings?.recentModels?.find(
        (model) => model.provider !== "claude-code",
      ) ?? { provider: "auto", name: "auto" }
    );
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
