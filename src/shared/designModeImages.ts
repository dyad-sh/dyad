import { isDyadProEnabled, type UserSettings } from "@/lib/schemas";

/**
 * Whether design mode may generate images this turn.
 *
 * Single source of truth shared by the prompt (chat_stream_handlers) and the
 * tool set (local_agent_handler). They must agree: a prompt that tells the
 * model to generate imagery while `generate_image` is filtered out of the tool
 * set produces a turn that stalls on a tool it cannot call.
 *
 * Beyond the user's opt-in, the two conditions mirror the tool's own gates:
 * `generate_image.isEnabled` requires Pro, and `usesEngineEndpoint` filters it
 * out under the free Pro model (which only speaks to chat-completions).
 */
export function isDesignImageGenerationEnabled({
  settings,
  freeModelMode,
}: {
  settings: UserSettings;
  freeModelMode?: boolean;
}): boolean {
  return (
    settings.enableDesignModeImages === true &&
    isDyadProEnabled(settings) &&
    !freeModelMode
  );
}
