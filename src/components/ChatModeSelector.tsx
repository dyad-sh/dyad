import {
  MiniSelectTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useSettings } from "@/hooks/useSettings";
import { useChatMode } from "@/hooks/useChatMode";
import { useFreeAgentQuota } from "@/hooks/useFreeAgentQuota";
import type { ChatMode } from "@/lib/schemas";
import { isDyadProEnabled } from "@/lib/schemas";
import {
  getChatModeFallbackToastId,
  getChatModeDisplayName,
  showChatModeFallbackToast,
} from "@/lib/chatModeToast";
import { cn } from "@/lib/utils";
import { detectIsMac } from "@/hooks/useChatModeToggle";
import { useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { LocalAgentNewChatToast } from "./LocalAgentNewChatToast";
import { useAtomValue, useSetAtom } from "jotai";
import {
  chatMessagesByIdAtom,
  hasManuallySelectedChatModeAtom,
} from "@/atoms/chatAtoms";
import { Hammer, Bot, MessageCircle, Lightbulb } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  FREE_PRO_MODEL_FALLBACK_CHAT_MODE,
  isFreeProBuildModeCombination,
  isFreeProModel,
} from "@/lib/freeProModel";

export function ChatModeSelector() {
  const { t } = useTranslation("chat");
  const { updateSettings } = useSettings();
  const routerState = useRouterState();
  const isChatRoute = routerState.location.pathname === "/chat";
  const messagesById = useAtomValue(chatMessagesByIdAtom);
  const chatId = routerState.location.search.id as number | undefined;
  const currentChatMessages = chatId ? (messagesById.get(chatId) ?? []) : [];
  const {
    selectedMode,
    effectiveMode,
    storedChatMode,
    fallbackReason,
    setChatMode,
    settings,
  } = useChatMode(isChatRoute ? chatId : null);
  const setHasManuallySelectedChatMode = useSetAtom(
    hasManuallySelectedChatModeAtom,
  );
  const fallbackToastKeyRef = useRef<string | null>(null);

  const isProEnabled = settings ? isDyadProEnabled(settings) : false;
  const { messagesRemaining, messagesLimit, isQuotaExceeded } =
    useFreeAgentQuota();
  const isDyadFreeSelected = isFreeProModel(settings?.selectedModel);
  const buildUnavailableForDyadFree = isDyadFreeSelected;

  useEffect(() => {
    if (!chatId || !fallbackReason || !storedChatMode) {
      fallbackToastKeyRef.current = null;
      return;
    }

    const toastKey = getChatModeFallbackToastId({
      chatId,
      reason: fallbackReason,
      effectiveMode,
    });
    if (fallbackToastKeyRef.current === toastKey) {
      return;
    }

    fallbackToastKeyRef.current = toastKey;
    showChatModeFallbackToast({
      effectiveMode,
      isPro: isProEnabled,
      toastId: toastKey,
    });
  }, [chatId, effectiveMode, fallbackReason, isProEnabled, storedChatMode]);

  useEffect(() => {
    if (
      settings &&
      isFreeProBuildModeCombination(settings.selectedModel, selectedMode)
    ) {
      void setChatMode(FREE_PRO_MODEL_FALLBACK_CHAT_MODE).catch(() => {});
    }
  }, [selectedMode, setChatMode, settings]);

  const handleModeChange = (value: string) => {
    const newMode = value as ChatMode;
    if (
      settings &&
      isFreeProBuildModeCombination(settings.selectedModel, newMode)
    ) {
      toast.error(t("chatMode.buildUnavailable"));
      return;
    }
    // An explicit pick outside a chat updates settings.selectedChatMode;
    // latch so the home page stops syncing it to the effective default.
    if (!isChatRoute || chatId == null) {
      setHasManuallySelectedChatMode(true);
    }
    void setChatMode(newMode).catch(() => {});

    // We want to show a toast when user is switching to the new agent mode
    // because they might weird results mixing Build and Agent mode in the same chat.
    //
    // Only show toast if:
    // - User is switching to the new agent mode
    // - User is on the chat (not home page) with existing messages
    // - User has not explicitly disabled the toast
    if (
      newMode === "local-agent" &&
      isChatRoute &&
      currentChatMessages.length > 0 &&
      !settings?.hideLocalAgentNewChatToast
    ) {
      toast.custom(
        (t) => (
          <LocalAgentNewChatToast
            toastId={t}
            onNeverShowAgain={() => {
              updateSettings({ hideLocalAgentNewChatToast: true });
            }}
          />
        ),
        // Make the toast shorter in test mode for faster tests.
        { duration: settings?.isTestMode ? 50 : 8000 },
      );
    }
  };

  const getModeDisplayName = (mode: ChatMode) => {
    switch (mode) {
      case "build":
        return t("chatMode.build");
      case "ask":
        return t("chatMode.ask");
      case "plan":
        return t("chatMode.plan");
      case "local-agent":
        return t(isProEnabled ? "chatMode.agentV2" : "chatMode.basicAgent");
      default:
        return getChatModeDisplayName(mode, isProEnabled);
    }
  };

  const getModeIcon = (mode: ChatMode) => {
    switch (mode) {
      case "build":
        return <Hammer size={14} />;
      case "ask":
        return <MessageCircle size={14} />;
      case "local-agent":
        return <Bot size={14} />;
      case "plan":
        return <Lightbulb size={14} />;
      default:
        return <Hammer size={14} />;
    }
  };
  const isMac = detectIsMac();

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={selectedMode}
        onValueChange={(v) => v && handleModeChange(v)}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <MiniSelectTrigger
                data-testid="chat-mode-selector"
                aria-label={t("chatMode.ariaLabel", {
                  mode: getModeDisplayName(selectedMode),
                })}
                className={cn(
                  "cursor-pointer w-fit px-2 py-0 text-xs font-medium border-none shadow-none gap-1 rounded-lg transition-colors",
                  selectedMode === "build" || selectedMode === "local-agent"
                    ? "text-foreground/80 hover:text-foreground hover:bg-muted/60"
                    : selectedMode === "ask"
                      ? "bg-purple-500/10 text-purple-600 hover:bg-purple-500/15 dark:bg-purple-500/15 dark:text-purple-400 dark:hover:bg-purple-500/20"
                      : selectedMode === "plan"
                        ? "bg-blue-500/10 text-blue-600 hover:bg-blue-500/15 dark:bg-blue-500/15 dark:text-blue-400 dark:hover:bg-blue-500/20"
                        : "text-foreground/80 hover:text-foreground hover:bg-muted/60",
                )}
                size="sm"
              />
            }
          >
            <SelectValue>
              <span className="flex items-center gap-1.5">
                {getModeIcon(selectedMode)}
                {getModeDisplayName(selectedMode)}
              </span>
            </SelectValue>
          </TooltipTrigger>
          <TooltipContent>
            {t("chatMode.openMenuShortcut", {
              shortcut: isMac ? "\u2318 + ." : "Ctrl + .",
            })}
          </TooltipContent>
        </Tooltip>
        <SelectContent align="start">
          {isProEnabled && (
            <SelectItem value="local-agent">
              <div className="flex flex-col items-start">
                <div className="flex items-center gap-1.5">
                  <Bot size={14} className="text-muted-foreground" />
                  <span className="font-medium">{t("chatMode.agentV2")}</span>
                </div>
                <span className="text-xs text-muted-foreground ml-[22px]">
                  {t("chatMode.agentV2Description")}
                </span>
              </div>
            </SelectItem>
          )}
          <SelectItem value="plan">
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-1.5">
                <Lightbulb size={14} className="text-blue-500" />
                <span className="font-medium">{t("chatMode.plan")}</span>
              </div>
              <span className="text-xs text-muted-foreground ml-[22px]">
                {t("chatMode.planDescription")}
              </span>
            </div>
          </SelectItem>
          {!isProEnabled && (
            <SelectItem value="local-agent" disabled={isQuotaExceeded}>
              <div className="flex flex-col items-start">
                <div className="flex items-center gap-1.5">
                  <Bot size={14} className="text-muted-foreground" />
                  <span className="font-medium">
                    {t("chatMode.basicAgent")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("chatMode.remaining", {
                      remaining: isQuotaExceeded ? 0 : messagesRemaining,
                      limit: messagesLimit,
                    })}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground ml-[22px]">
                  {isQuotaExceeded
                    ? t("chatMode.dailyLimitReached")
                    : t("chatMode.tryAgentFree")}
                </span>
              </div>
            </SelectItem>
          )}
          <SelectItem value="build" disabled={buildUnavailableForDyadFree}>
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-1.5">
                <Hammer size={14} className="text-muted-foreground" />
                <span className="font-medium">{t("chatMode.build")}</span>
              </div>
              <span className="text-xs text-muted-foreground ml-[22px]">
                {buildUnavailableForDyadFree
                  ? t("chatMode.buildUnavailableDescription")
                  : t("chatMode.buildDescription")}
              </span>
            </div>
          </SelectItem>
          <SelectItem value="ask">
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-1.5">
                <MessageCircle size={14} className="text-purple-500" />
                <span className="font-medium">{t("chatMode.ask")}</span>
              </div>
              <span className="text-xs text-muted-foreground ml-[22px]">
                {t("chatMode.askDescription")}
              </span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
