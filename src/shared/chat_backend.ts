/**
 * Chat execution backends.
 *
 * Dyad can run a chat turn through two execution backends:
 *
 * - `dyad`: the existing Dyad model/tool loop (Dyad Pro credits, user API
 *   keys, and local models all run here).
 * - `claude-code`: the user's Claude Code subscription through the official
 *   local `claude` CLI. Claude Code runs the agent; Dyad provides the chat UI,
 *   a controlled set of Dyad operations, and usage accounting.
 *
 * This module is renderer-safe (no Electron/Node imports) so the picker, the
 * message footer, and the main process all share one definition of which
 * model selection maps to which backend.
 */
import type { LargeLanguageModel } from "@/lib/schemas";

export type ChatExecutionBackend = "dyad" | "claude-code";

export const CHAT_EXECUTION_BACKENDS: readonly ChatExecutionBackend[] = [
  "dyad",
  "claude-code",
] as const;

/**
 * Provider id used in `LargeLanguageModel.provider` for subscription-backed
 * Claude Code selections. It is not a Dyad language-model provider (there is
 * no API key, gateway prefix, or catalog entry); the backend is resolved from
 * the provider id alone.
 */
export const CLAUDE_CODE_PROVIDER_ID = "claude-code";

export interface ClaudeCodeModelOption {
  /** Value passed to `claude --model`. Aliases resolve to the latest release. */
  name: string;
  displayName: string;
  description: string;
}

/**
 * Curated model choices offered under the Subscription section. Aliases are
 * resolved by the CLI, and the resolved model id reported by the CLI is what
 * gets persisted for attribution and pricing.
 */
export const CLAUDE_CODE_MODEL_OPTIONS: readonly ClaudeCodeModelOption[] = [
  {
    name: "opus",
    displayName: "Claude Opus (latest)",
    description: "Most capable Claude model available to your subscription",
  },
  {
    name: "sonnet",
    displayName: "Claude Sonnet (latest)",
    description: "Fast, balanced Claude model",
  },
  {
    name: "claude-opus-4-8",
    displayName: "Claude Opus 4.8",
    description: "Pinned Opus 4.8 release",
  },
  {
    name: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    description: "Pinned Sonnet 5 release",
  },
] as const;

/** Effort levels accepted by `claude --effort`. */
export const CLAUDE_CODE_EFFORT_SETTINGS = {
  defaultEffortLevel: "high",
  possibleEffortLevels: ["low", "medium", "high", "xhigh", "max"],
} as const;

export function isClaudeCodeModel(
  model: Pick<LargeLanguageModel, "provider"> | null | undefined,
): boolean {
  return model?.provider === CLAUDE_CODE_PROVIDER_ID;
}

export function getBackendForModel(
  model: Pick<LargeLanguageModel, "provider"> | null | undefined,
): ChatExecutionBackend {
  return isClaudeCodeModel(model) ? "claude-code" : "dyad";
}

export function getClaudeCodeModelDisplayName(name: string): string {
  return (
    CLAUDE_CODE_MODEL_OPTIONS.find((option) => option.name === name)
      ?.displayName ?? name
  );
}

/**
 * Resolve the backend a chat is bound to. Chats created before the explicit
 * column existed derive it from their latched model selection; chats without
 * any latched selection are unbound until their first accepted turn.
 */
export function resolveChatExecutionBackend(chat: {
  executionBackend?: ChatExecutionBackend | null;
  modelSelection?: Pick<LargeLanguageModel, "provider"> | null;
  messages?: readonly unknown[];
}): ChatExecutionBackend | null {
  if (chat.executionBackend) {
    return chat.executionBackend;
  }
  if (chat.modelSelection) {
    return getBackendForModel(chat.modelSelection);
  }
  return null;
}

export const BACKEND_SWITCH_REQUIRES_NEW_CHAT_MESSAGE =
  "Switching backends requires a new chat. Your current chat will stay unchanged.";

export const BACKEND_SWITCH_START_NEW_CHAT_LABEL = "Start new chat";
export const BACKEND_SWITCH_CANCEL_LABEL = "Cancel";

/**
 * Whether selecting `nextModel` for `chat` would change the chat's execution
 * backend. Model changes inside the same backend never require a new chat.
 */
export function wouldChangeChatBackend(
  chat: Parameters<typeof resolveChatExecutionBackend>[0],
  nextModel: Pick<LargeLanguageModel, "provider">,
): boolean {
  const current = resolveChatExecutionBackend(chat);
  if (current === null) {
    return false;
  }
  return current !== getBackendForModel(nextModel);
}

export const CLAUDE_CODE_ATTRIBUTION_PREFIX = "Claude Code";
export const CLAUDE_CODE_UNKNOWN_MODEL_LABEL = "model not reported";

/**
 * Footer attribution for an assistant message.
 *
 * Subscription-backed responses render as `Claude Code (<resolved model>)`.
 * The resolved model is the id the CLI reported for the turn; when the CLI
 * never reported one (for example a failure before the first model response),
 * the explicit fallback `Claude Code (model not reported)` is used rather than
 * the picker's selection, because that selection may be an alias the CLI
 * would have resolved differently.
 *
 * Other responses keep the existing plain model attribution.
 */
export function formatAssistantModelAttribution(message: {
  executionBackend?: ChatExecutionBackend | null;
  model?: string | null;
}): string | null {
  if (message.executionBackend === "claude-code") {
    const model = message.model?.trim();
    return `${CLAUDE_CODE_ATTRIBUTION_PREFIX} (${model || CLAUDE_CODE_UNKNOWN_MODEL_LABEL})`;
  }
  const model = message.model?.trim();
  return model ? model : null;
}
