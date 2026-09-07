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
