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
import type { ChatMode } from "@/lib/schemas";
import { getChatModeDisplayName } from "@/lib/chatModeToast";
import { cn } from "@/lib/utils";
import { detectIsMac } from "@/hooks/useChatModeToggle";
import { useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { LocalAgentNewChatToast } from "./LocalAgentNewChatToast";
import { useSetAtom } from "jotai";
import { hasManuallySelectedChatModeAtom } from "@/atoms/chatAtoms";
import { useChatMessageCount } from "@/hooks/useChatMessages";
import { Bot, MessageCircle, Lightbulb } from "lucide-react";

export function ChatModeSelector() {
  const { updateSettings } = useSettings();
  const routerState = useRouterState();
  const isChatRoute = routerState.location.pathname === "/chat";
  const chatId = routerState.location.search.id as number | undefined;
  const currentChatMessageCount = useChatMessageCount(chatId);
  const { selectedMode, setChatMode, settings } = useChatMode(
    isChatRoute ? chatId : null,
  );
  const setHasManuallySelectedChatMode = useSetAtom(
    hasManuallySelectedChatModeAtom,
  );
  const handleModeChange = (value: string) => {
    const newMode = value as ChatMode;
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
      currentChatMessageCount > 0 &&
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

  const getModeDisplayName = (mode: ChatMode) => getChatModeDisplayName(mode);

  const getModeIcon = (mode: ChatMode) => {
    switch (mode) {
      case "ask":
        return <MessageCircle size={14} />;
      case "local-agent":
        return <Bot size={14} />;
      case "plan":
        return <Lightbulb size={14} />;
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
                aria-label={`Chat mode: ${getModeDisplayName(selectedMode)}`}
                className={cn(
                  "cursor-pointer w-fit px-2 py-0 text-xs font-medium border-none shadow-none gap-1 rounded-lg transition-colors",
                  selectedMode === "local-agent"
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
          <SelectItem value="local-agent">
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-1.5">
                <Bot size={14} className="text-muted-foreground" />
                <span className="font-medium">Agent</span>
              </div>
              <span className="text-xs text-muted-foreground ml-[22px]">
                Build and debug with tools
              </span>
            </div>
          </SelectItem>
          <SelectItem value="plan">
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-1.5">
                <Lightbulb size={14} className="text-blue-500" />
                <span className="font-medium">Plan</span>
              </div>
              <span className="text-xs text-muted-foreground ml-[22px]">
                Design before you build
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
    </div>
  );
}
