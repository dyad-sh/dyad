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
import type { ChatMode } from "@/lib/schemas";
import { isDyadProEnabled } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { detectIsMac } from "@/hooks/useChatModeToggle";
import { useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { LocalAgentNewChatToast } from "./LocalAgentNewChatToast";
import { useAtomValue } from "jotai";
import { chatMessagesByIdAtom } from "@/atoms/chatAtoms";

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
  const chatId = routerState.location.search.id as number | undefined;
  const currentChatMessages = chatId ? (messagesById.get(chatId) ?? []) : [];

  const selectedMode = settings?.selectedChatMode || "build";
  const isProEnabled = settings ? isDyadProEnabled(settings) : false;
  const { messagesRemaining, isQuotaExceeded } = useFreeAgentQuota();

  const handleModeChange = (value: string) => {
    const newMode = value as ChatMode;
    updateSettings({ selectedChatMode: newMode });

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
      case "agent":
        return "Build (MCP)";
      case "local-agent":
        // Show "Basic Agent" for non-Pro users, "Agent" for Pro users
        return isProEnabled ? "Agent" : "Basic Agent";
      case "plan":
        return "Plan";
      default:
        return "Build";
    }
  };
  const isMac = detectIsMac();

  return (
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
                "h-6 w-fit px-1.5 py-0 text-xs-sm font-medium shadow-none gap-0.5",
                selectedMode === "build" ||
                  selectedMode === "local-agent" ||
                  selectedMode === "plan"
                  ? "bg-background hover:bg-muted/50 focus:bg-muted/50"
                  : "bg-primary/10 hover:bg-primary/20 focus:bg-primary/20 text-primary border-primary/20 dark:bg-primary/20 dark:hover:bg-primary/30 dark:focus:bg-primary/30",
              )}
              size="sm"
            />
          }
        >
          <SelectValue>{getModeDisplayName(selectedMode)}</SelectValue>
        </TooltipTrigger>
        <TooltipContent>
          {`Open mode menu (${isMac ? "\u2318 + ." : "Ctrl + ."} to toggle)`}
        </TooltipContent>
      </Tooltip>
      <SelectContent align="start">
        {isProEnabled && (
          <>
            <SelectItem value="local-agent">
              <div className="flex flex-col items-start">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">Agent v2</span>
                  <NewBadge />
                </div>
                <span className="text-xs text-muted-foreground">
                  Better at bigger tasks and debugging
                </span>
              </div>
            </SelectItem>
            <SelectItem value="plan">
              <div className="flex flex-col items-start">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">Plan</span>
                  <NewBadge />
                </div>
                <span className="text-xs text-muted-foreground">
                  Design before you build
                </span>
              </div>
            </SelectItem>
          </>
        )}
        {!isProEnabled && (
          <SelectItem value="local-agent" disabled={isQuotaExceeded}>
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-1.5">
                <span className="font-medium">Basic Agent</span>
                <span className="text-xs text-muted-foreground">
                  ({isQuotaExceeded ? "0" : messagesRemaining}/5 remaining for
                  today)
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {isQuotaExceeded
                  ? "Daily limit reached"
                  : "Try our AI agent for free"}
              </span>
            </div>
          </SelectItem>
        )}
        <SelectItem value="build">
          <div className="flex flex-col items-start">
            <span className="font-medium">Build</span>
            <span className="text-xs text-muted-foreground">
              Generate and edit code
            </span>
          </div>
        </SelectItem>
        <SelectItem value="ask">
          <div className="flex flex-col items-start">
            <span className="font-medium">Ask</span>
            <span className="text-xs text-muted-foreground">
              Ask questions about the app
            </span>
          </div>
        </SelectItem>
        <SelectItem value="agent">
          <div className="flex flex-col items-start">
            <div className="flex items-center gap-1.5">
              <span className="font-medium">Build with MCP</span>
            </div>
            <span className="text-xs text-muted-foreground">
              Like Build, but can use tools (MCP) to generate code
            </span>
          </div>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
