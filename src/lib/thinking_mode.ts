import type { UserSettings } from "@/lib/schemas";
import { isLocalProviderId } from "@/lib/local_provider_utils";

/**
 * Turning a reasoning model's deliberation off.
 *
 * Qwen-family models honour a `/no_think` marker in the user turn: the model
 * still emits a `<think>` block, but an empty one, and answers immediately.
 * That is worth having as a switch rather than something typed every message,
 * because a small reasoning model will otherwise deliberate for seconds over
 * "hi".
 *
 * Applied only to local providers. A cloud model has its own reasoning
 * controls, and appending a stray marker to a paid request would just waste
 * tokens and confuse the model.
 */

export const NO_THINK_MARKER = "/no_think";

/** Whether thinking is switched off for this provider. */
export function isThinkingDisabled(
  settings: UserSettings | null | undefined,
  providerId: string,
): boolean {
  if (!isLocalProviderId(providerId)) return false;
  const provider = settings?.providerSettings?.[providerId] as
    | { disableThinking?: boolean }
    | undefined;
  return provider?.disableThinking === true;
}

/**
 * Adds the marker to a message, once.
 *
 * Appending it twice is harmless to the model but noisy in a saved
 * conversation, and the marker must not land inside a code block, so it goes
 * on the end rather than anywhere clever.
 */
export function applyThinkingMode(message: string, disabled: boolean): string {
  if (!disabled) return message;
  const trimmed = message.trimEnd();
  if (!trimmed) return message;
  if (trimmed.endsWith(NO_THINK_MARKER)) return message;
  return `${trimmed} ${NO_THINK_MARKER}`;
}
