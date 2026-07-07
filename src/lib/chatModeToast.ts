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
    case "design":
      return "Design";
  }
}

export function getChatModeFallbackToastId({
  chatId,
  reason,
  effectiveMode,
}: {
  chatId?: number;
  reason: ChatModeFallbackReason;
  effectiveMode: ChatMode;
}) {
  return chatId
    ? `chat-mode-fallback:${chatId}:${reason}:${effectiveMode}`
    : `chat-mode-fallback:${reason}:${effectiveMode}`;
}

export function showChatModeFallbackToast({
  effectiveMode,
  isPro,
  toastId,
  reason,
}: {
  effectiveMode: ChatMode;
  isPro: boolean;
  toastId?: string;
  reason?: ChatModeFallbackReason;
}) {
  const modeName = getChatModeDisplayName(effectiveMode, isPro);
  const message =
    reason === "pro-required"
      ? `Design mode requires Dyad Pro. Using ${modeName} mode.`
      : `Quota exhausted. Using ${modeName} mode.`;

  toast.warning(message, {
    id: toastId,
    duration: 8000,
    action: {
      label: "Switch mode",
      onClick: () => {
        const trigger = document.querySelector<HTMLElement>(
          '[data-testid="chat-mode-selector"]',
        );
        if (trigger) {
          trigger.focus();
          trigger.click();
          return;
        }

        if (toastId) {
          toast.dismiss(toastId);
        }
        toast.info("Open a chat to switch modes.", { duration: 5000 });
      },
    },
  });
}
