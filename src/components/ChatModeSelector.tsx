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
import { useChatSettings } from "@/hooks/useChatSettings";
import type { ChatMode } from "@/lib/schemas";
import { isDyadProEnabled } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { detectIsMac } from "@/hooks/useChatModeToggle";
import { useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { LocalAgentNewChatToast } from "./LocalAgentNewChatToast";
import { useAtomValue } from "jotai";
import { chatMessagesByIdAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";
import { Hammer, Bot, MessageCircle, Lightbulb } from "lucide-react";

function NewBadge() {
  return (
    <span className="inline-flex items-center rounded-full px-2 text-[11px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
      New
    </span>
  );
}

export function ChatModeSelector() {
  const { settings, updateSettings } = useSettings();
  const routerState = useRouterState();
  const isChatRoute = routerState.location.pathname === "/chat";
  const messagesById = useAtomValue(chatMessagesByIdAtom);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const chatId = routerState.location.search.id as number | undefined;
  const currentChatMessages = chatId ? (messagesById.get(chatId) ?? []) : [];

  // Use per-chat settings when a chat is selected
  const { effectiveChatMode, updateChatMode: updatePerChatMode } =
    useChatSettings(selectedChatId);

  // Use per-chat mode if available, otherwise fall back to global
  const selectedMode = selectedChatId
    ? effectiveChatMode
    : settings?.selectedChatMode || "build";
  const isProEnabled = settings ? isDyadProEnabled(settings) : false;
  const { messagesRemaining, isQuotaExceeded } = useFreeAgentQuota();
  const { servers } = useMcp();
  const enabledMcpServersCount = servers.filter((s) => s.enabled).length;

  const handleModeChange = (value: string) => {
    const newMode = value as ChatMode;
    // If a chat is selected, update per-chat settings; otherwise update global
    if (selectedChatId) {
      updatePerChatMode(newMode);
    } else {
      updateSettings({ selectedChatMode: newMode });
    }

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
        return "Build";
      case "ask":
        return "Ask";
      case "local-agent":
        // Show "Basic Agent" for non-Pro users, "Agent" for Pro users
        return isProEnabled ? "Agent" : "Basic Agent";
      case "plan":
        return "Plan";
      default:
        return "Build";
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
            {`Open mode menu (${isMac ? "\u2318 + ." : "Ctrl + ."} to toggle)`}
          </TooltipContent>
        </Tooltip>
        <SelectContent align="start">
          {isProEnabled && (
            <SelectItem value="local-agent">
              <div className="flex flex-col items-start">
                <div className="flex items-center gap-1.5">
                  <Bot size={14} className="text-muted-foreground" />
                  <span className="font-medium">Agent v2</span>
                  <NewBadge />
                </div>
                <span className="text-xs text-muted-foreground ml-[22px]">
                  Better at bigger tasks and debugging
                </span>
              </div>
            </SelectItem>
          )}
          <SelectItem value="plan">
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-1.5">
                <Lightbulb size={14} className="text-blue-500" />
                <span className="font-medium">Plan</span>
                <NewBadge />
              </div>
              <span className="text-xs text-muted-foreground ml-[22px]">
                Design before you build
              </span>
            </div>
          </SelectItem>
          {!isProEnabled && (
            <SelectItem value="local-agent" disabled={isQuotaExceeded}>
              <div className="flex flex-col items-start">
                <div className="flex items-center gap-1.5">
                  <Bot size={14} className="text-muted-foreground" />
                  <span className="font-medium">Basic Agent</span>
                  <span className="text-xs text-muted-foreground">
                    ({isQuotaExceeded ? "0" : messagesRemaining}/5 remaining for
                    today)
                  </span>
                </div>
                <span className="text-xs text-muted-foreground ml-[22px]">
                  {isQuotaExceeded
                    ? "Daily limit reached"
                    : "Try our AI agent for free"}
                </span>
              </div>
            </SelectItem>
          )}
          <SelectItem value="build">
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-1.5">
                <Hammer size={14} className="text-muted-foreground" />
                <span className="font-medium">Build</span>
              </div>
              <span className="text-xs text-muted-foreground ml-[22px]">
                Generate and edit code
              </span>
            </div>
          </SelectItem>
          <SelectItem value="ask">
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-1.5">
                <MessageCircle size={14} className="text-purple-500" />
                <span className="font-medium">Ask</span>
              </div>
              <span className="text-xs text-muted-foreground ml-[22px]">
                Ask questions about the app
              </span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
      {selectedMode === "build" && <McpChip count={enabledMcpServersCount} />}
    </div>
  );
}

function McpChip({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            data-testid="mcp-servers-chip"
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400 border border-purple-200 dark:border-purple-800 cursor-default"
          />
        }
      >
        {count} MCP
      </TooltipTrigger>
      <TooltipContent>
        <span>
          {count} MCP server{count !== 1 ? "s" : ""} enabled
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
