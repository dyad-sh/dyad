import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { useFreeAgentQuota } from "@/hooks/useFreeAgentQuota";
import { useMcp } from "@/hooks/useMcp";
import type { ChatMode } from "@/lib/schemas";
import {
  isChatModeAllowed,
  isDyadProEnabled,
  getEffectiveDefaultChatMode,
} from "@/lib/schemas";
import { cn } from "@/lib/utils";
import {
  getLocalAgentUnavailableReasonKey,
  getChatModeLabelKey,
} from "@/lib/chatModeUtils";
import { toast } from "sonner";
import { LocalAgentNewChatToast } from "./LocalAgentNewChatToast";
import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { Hammer, Bot, MessageCircle, Lightbulb, Loader2 } from "lucide-react";
import { useChats } from "@/hooks/useChats";
import { usePersistChatMode } from "@/hooks/usePersistChatMode";
import { useCurrentChatIdFromRoute } from "@/hooks/useCurrentChatIdFromRoute";
import { useIsMac } from "@/lib/platformUtils";
import { useRouterState } from "@tanstack/react-router";
import { chatMessagesByIdAtom } from "@/atoms/chatAtoms";

export function ChatModeSelector() {
  const { t } = useTranslation("chat");
  const { settings, updateSettings, envVars } = useSettings();
  const getCurrentChatId = useCurrentChatIdFromRoute();
  const chatId = getCurrentChatId();
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { invalidateChats } = useChats(selectedAppId);
  const [isPersisting, setIsPersisting] = useState(false);
  const { persistChatMode } = usePersistChatMode();

  const isMac = useIsMac();
  const routerState = useRouterState();
  const isChatRoute = routerState.location.pathname === "/chat";
  const messagesById = useAtomValue(chatMessagesByIdAtom);
  const currentChatMessages = chatId ? (messagesById.get(chatId) ?? []) : [];

  const {
    isQuotaExceeded,
    messagesRemaining,
    messagesLimit,
    isLoading: isQuotaLoading,
  } = useFreeAgentQuota();
  const freeAgentQuotaAvailable = !isQuotaLoading && !isQuotaExceeded;

  const effectiveDefaultMode = settings
    ? getEffectiveDefaultChatMode(settings, envVars, freeAgentQuotaAvailable)
    : "build";
  const selectedMode = settings?.selectedChatMode || effectiveDefaultMode;
  const isProEnabled = settings ? isDyadProEnabled(settings) : false;
  const { servers } = useMcp();
  const enabledMcpServersCount = servers.filter((s) => s.enabled).length;
  const isLocalAgentAllowed =
    !!settings &&
    isChatModeAllowed(
      "local-agent",
      settings,
      envVars,
      freeAgentQuotaAvailable,
    );

  const getLocalAgentUnavailableMessage = () => {
    const reasonKey = getLocalAgentUnavailableReasonKey(isQuotaExceeded);
    return t(reasonKey, {
      defaultValue:
        reasonKey === "chatMode.agentUnavailableQuota"
          ? "Agent mode unavailable — free quota exceeded"
          : "Agent mode requires an OpenAI or Anthropic provider",
    });
  };

  const getModeDisplayName = (mode: ChatMode) => {
    return t(getChatModeLabelKey(mode, { isProEnabled }), {
      defaultValue:
        mode === "local-agent"
          ? isProEnabled
            ? "Agent"
            : "Basic Agent"
          : mode,
    });
  };

  const handleModeChange = (value: ChatMode | null) => {
    if (!value || value === selectedMode) {
      return;
    }

    const performChange = async () => {
      if (value === "local-agent" && !isLocalAgentAllowed) {
        toast.error(getLocalAgentUnavailableMessage());
        return;
      }

      setIsPersisting(true);

      try {
        if (chatId && selectedAppId) {
          const result = await persistChatMode({
            chatId,
            appId: selectedAppId,
            chatMode: value,
            optimistic: true,
            onPersistSuccess: () => {
              invalidateChats();
            },
            onPersistError: () => {
              toast.error(
                t("chatMode.persistFailed", {
                  defaultValue: "Failed to save chat mode to database",
                }),
              );
            },
          });

          if (!result.success || !result.sameRoute) {
            return;
          }
        } else {
          await updateSettings({ selectedChatMode: value });
        }

        if (
          value === "local-agent" &&
          isChatRoute &&
          currentChatMessages.length > 0 &&
          (!settings || !settings.hideLocalAgentNewChatToast)
        ) {
          toast.custom(
            (t_toast) => (
              <LocalAgentNewChatToast
                toastId={t_toast}
                onNeverShowAgain={() =>
                  updateSettings({ hideLocalAgentNewChatToast: true })
                }
              />
            ),
            {
              duration: settings?.isTestMode ? 50 : 8000,
            },
          );
        }
      } finally {
        setIsPersisting(false);
      }
    };

    void performChange();
  };

  const getIconForMode = (mode: ChatMode) => {
    switch (mode) {
      case "build":
        return <Hammer size={12} />;
      case "ask":
        return <MessageCircle size={12} />;
      case "local-agent":
        return <Bot size={12} />;
      case "plan":
        return <Lightbulb size={12} />;
      default:
        return null;
    }
  };

  const getModeTooltip = (mode: ChatMode) => {
    switch (mode) {
      case "build":
        return t("chatMode.buildDesc", {
          defaultValue: "Build: Best for coding and generating code.",
        });
      case "ask":
        return t("chatMode.askDesc", {
          defaultValue: "Ask: Best for answering questions about your code.",
        });
      case "local-agent":
        return t("chatMode.agentDesc", {
          defaultValue:
            "Agent: Best for complex tasks that require multiple steps.",
        });
      case "plan":
        return t("chatMode.planDesc", {
          defaultValue: "Plan: Best for planning out a new feature.",
        });
      default:
        return "";
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Select value={selectedMode} onValueChange={handleModeChange}>
        <Tooltip>
          <TooltipTrigger
            render={
              <MiniSelectTrigger
                data-testid="chat-mode-selector"
                aria-label={t("chatMode.currentMode", {
                  defaultValue: "Current mode: {{mode}}",
                  mode: getModeDisplayName(selectedMode),
                })}
                disabled={isPersisting}
                className={cn(
                  "cursor-pointer w-fit px-2 py-0 text-xs font-medium border-none shadow-none gap-1 rounded-lg transition-colors",
                  isPersisting && "opacity-70",
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
              <span className="flex items-center gap-1.5" aria-hidden="true">
                {isPersisting ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  getIconForMode(selectedMode)
                )}
                {getModeDisplayName(selectedMode)}
              </span>
              {isPersisting && (
                <span className="sr-only">
                  {t("chatMode.persisting", {
                    defaultValue: "Saving...",
                  })}
                </span>
              )}
            </SelectValue>
          </TooltipTrigger>
          <TooltipContent>
            {t("chatMode.toggleShortcut", {
              defaultValue: "{{modeDescription}} ({{shortcut}} to toggle)",
              modeDescription: getModeTooltip(selectedMode),
              shortcut: isMac ? "⌘ + ." : "Ctrl + .",
            })}
          </TooltipContent>
        </Tooltip>
        <SelectContent align="start" className="min-w-[150px]">
          <ModeOption
            mode="ask"
            icon={<MessageCircle size={14} />}
            label="Ask"
            description="Best for asking questions"
            isProEnabled={isProEnabled}
            t={t}
          />
          <ModeOption
            mode="build"
            icon={<Hammer size={14} />}
            label="Build"
            description="Best for coding"
            isProEnabled={isProEnabled}
            t={t}
          />
          <ModeOption
            mode="local-agent"
            icon={<Bot size={14} />}
            label={isProEnabled ? "Agent" : "Basic Agent"}
            description="Best for multi-step tasks"
            disabled={!isLocalAgentAllowed}
            disabledReason={getLocalAgentUnavailableMessage()}
            isProEnabled={isProEnabled}
            t={t}
            badge={
              [
                enabledMcpServersCount > 0
                  ? t("chatMode.mcpCount", {
                      count: enabledMcpServersCount,
                    })
                  : null,
                !isProEnabled
                  ? t("chatMode.messagesRemaining", {
                      remaining: isQuotaExceeded ? 0 : messagesRemaining,
                      limit: messagesLimit,
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") || undefined
            }
          />
          <ModeOption
            mode="plan"
            icon={<Lightbulb size={14} />}
            label="Plan"
            description="Best for feature planning"
            isProEnabled={isProEnabled}
            t={t}
          />
        </SelectContent>
      </Select>
    </div>
  );
}

function ModeOption({
  mode,
  icon,
  label,
  description,
  disabled = false,
  disabledReason,
  isProEnabled,
  t,
  badge,
}: {
  mode: ChatMode;
  icon: React.ReactNode;
  label: string;
  description: string;
  isProEnabled: boolean;
  disabled?: boolean;
  disabledReason?: string;
  t: any;
  badge?: string;
}) {
  const content = (
    <SelectItem
      value={mode}
      disabled={disabled}
      className={cn(
        "flex flex-col items-start py-2 px-3 focus:bg-muted/60 relative",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-foreground/80">{icon}</span>
        <span className="font-medium text-sm">
          {t(getChatModeLabelKey(mode, { isProEnabled }), {
            defaultValue: label,
          })}
        </span>
        {badge && (
          <span className="text-xs px-1.5 rounded-sm bg-primary/10 text-primary border border-primary/20">
            {badge}
          </span>
        )}
      </div>
      <span className="text-[11px] text-muted-foreground ml-5">
        {t(`chatMode.${mode}DescMini`, { defaultValue: description })}
      </span>
      {disabled && disabledReason && (
        <span className="text-[10px] text-muted-foreground/70 ml-5 mt-0.5">
          {disabledReason}
        </span>
      )}
    </SelectItem>
  );

  return content;
}
