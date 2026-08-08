import { DyadError } from "@/errors/dyad_error";
import { getErrorMessage } from "@/lib/errors";

export interface ChatStreamErrorContext {
  provider?: string;
  modelName?: string;
}

/**
 * Turn raw LLM / IPC errors into short, actionable chat messages.
 */
export function formatChatStreamError(
  error: unknown,
  context: ChatStreamErrorContext = {},
): string {
  if (error instanceof DyadError) {
    return error.message;
  }

  const raw = getErrorMessage(error);
  const lower = raw.toLowerCase();
  const { provider, modelName } = context;

  if (
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("network error")
  ) {
    if (provider === "lmstudio") {
      return "Could not connect to LM Studio. Open LM Studio, enable Developer → Local Server, load a chat model until it shows READY, then try again.";
    }
    if (provider === "ollama") {
      return "Could not connect to Ollama. Make sure Ollama is running (ollama serve) and the server URL in Settings is correct.";
    }
  }

  if (
    modelName &&
    (lower.includes("model") || lower.includes("not found")) &&
    (lower.includes("not found") ||
      lower.includes("does not exist") ||
      lower.includes("unknown model") ||
      lower.includes("404") ||
      lower.includes("no such"))
  ) {
    if (provider === "lmstudio") {
      return `LM Studio does not have "${modelName}" loaded. Load that model in LM Studio (READY) or choose another model in the chat picker.`;
    }
    if (provider === "ollama") {
      return `Ollama does not have "${modelName}". Run \`ollama pull ${modelName.split(":")[0]}\` or pick another model.`;
    }
  }

  if (
    lower.includes("context length") ||
    lower.includes("maximum context") ||
    lower.includes("context window") ||
    lower.includes("too many tokens") ||
    lower.includes("prompt is too long")
  ) {
    return "The prompt is too large for this model's context window. Start a new chat, select fewer files, or switch to a model with a larger context.";
  }

  if (
    lower.includes("api key") ||
    lower.includes("authentication") ||
    lower.includes("unauthorized") ||
    lower.includes("401")
  ) {
    if (provider === "lmstudio" || provider === "ollama") {
      return raw;
    }
    return "API authentication failed. Check your API key in Settings for this provider.";
  }

  if (lower.includes("rate limit") || lower.includes("429")) {
    return "Rate limit reached. Wait a moment and try again, or switch to another model.";
  }

  if (lower.includes("aborted") || lower.includes("cancelled")) {
    return "Request was cancelled.";
  }

  return raw;
}
