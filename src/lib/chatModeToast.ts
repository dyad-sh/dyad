import { toast } from "sonner";
import type { ChatMode } from "./schemas";
import type { ChatModeFallbackReason } from "./chatMode";

export function getChatModeDisplayName(mode: ChatMode, isPro: boolean): string {
  switch (mode) {
    case "build":
      return "Build";
    case "ask":
      return "Ask";
    case "local-agent":
      return isPro ? "Agent" : "Basic Agent";
    case "plan":
      return "Plan";
  }
}

export function showChatModeFallbackToast({
  reason,
  effectiveMode,
  isPro,
}: {
  reason: ChatModeFallbackReason;
  effectiveMode: ChatMode;
  isPro: boolean;
}) {
  const modeName = getChatModeDisplayName(effectiveMode, isPro);
  const message =
    reason === "pro-required"
      ? `Agent v2 unavailable (Pro required). Using ${modeName} mode.`
      : reason === "quota-exhausted"
        ? `Quota exhausted. Using ${modeName} mode.`
        : `No provider configured. Using ${modeName} mode.`;

  toast.warning(message, {
    duration: 8000,
    action: {
      label: "Switch mode",
      onClick: () => {
        const trigger = document.querySelector<HTMLElement>(
          '[data-testid="chat-mode-selector"]',
        );
        trigger?.focus();
        trigger?.click();
      },
    },
  });
}
