import {
  MiniSelectTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSettings } from "@/hooks/useSettings";
import type { ChatMode } from "@/lib/schemas";
import { isDyadProEnabled } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { detectIsMac } from "@/hooks/useChatModeToggle";
import { useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { LocalAgentNewChatToast } from "./LocalAgentNewChatToast";
import { useAtomValue } from "jotai";
import { chatMessagesByIdAtom } from "@/atoms/chatAtoms";
import { Hammer, MessageCircle, Plug, Sparkles } from "lucide-react";

export function getModeIcon(mode: ChatMode) {
  switch (mode) {
    case "build":
      return Hammer;
    case "ask":
      return MessageCircle;
    case "agent":
      return Plug;
    case "local-agent":
      return Sparkles;
    default:
      return Hammer;
  }
}

export function getModeColorClasses(mode: ChatMode) {
  switch (mode) {
    case "build":
      return "bg-emerald-500/10 hover:bg-emerald-500/20 focus:bg-emerald-500/20 text-emerald-600 border-emerald-500/20 dark:bg-emerald-500/20 dark:hover:bg-emerald-500/30 dark:focus:bg-emerald-500/30 dark:text-emerald-400";
    case "ask":
      return "bg-blue-500/10 hover:bg-blue-500/20 focus:bg-blue-500/20 text-blue-600 border-blue-500/20 dark:bg-blue-500/20 dark:hover:bg-blue-500/30 dark:focus:bg-blue-500/30 dark:text-blue-400";
    case "agent":
      return "bg-purple-500/10 hover:bg-purple-500/20 focus:bg-purple-500/20 text-purple-600 border-purple-500/20 dark:bg-purple-500/20 dark:hover:bg-purple-500/30 dark:focus:bg-purple-500/30 dark:text-purple-400";
    case "local-agent":
      return "bg-background hover:bg-muted/50 focus:bg-muted/50";
    default:
      return "bg-background hover:bg-muted/50 focus:bg-muted/50";
  }
}

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
        return "Agent";
      default:
        return "Build";
    }
  };
  const isMac = detectIsMac();

  const ModeIcon = getModeIcon(selectedMode);

  return (
    <Select value={selectedMode} onValueChange={handleModeChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <MiniSelectTrigger
            data-testid="chat-mode-selector"
            className={cn(
              "h-6 w-fit px-1.5 py-0 text-xs-sm font-medium shadow-none gap-1",
              getModeColorClasses(selectedMode),
            )}
            size="sm"
          >
            <ModeIcon className="h-3.5 w-3.5" />
            <SelectValue>{getModeDisplayName(selectedMode)}</SelectValue>
          </MiniSelectTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <div className="flex flex-col">
            <span>Open mode menu</span>
            <span className="text-xs text-gray-200 dark:text-gray-500">
              {isMac ? "⌘ + ." : "Ctrl + ."} to toggle
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
      <SelectContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
        {isProEnabled && (
          <SelectItem value="local-agent">
            <div className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex flex-col items-start">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">Agent v2</span>
                  <NewBadge />
                </div>
                <span className="text-xs text-muted-foreground">
                  Better at bigger tasks and debugging
                </span>
              </div>
            </div>
          </SelectItem>
        )}
        <SelectItem value="build">
          <div className="flex items-start gap-2">
            <Hammer className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="flex flex-col items-start">
              <span className="font-medium">Build</span>
              <span className="text-xs text-muted-foreground">
                Generate and edit code
              </span>
            </div>
          </div>
        </SelectItem>
        <SelectItem value="ask">
          <div className="flex items-start gap-2">
            <MessageCircle className="h-4 w-4 mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
            <div className="flex flex-col items-start">
              <span className="font-medium">Ask</span>
              <span className="text-xs text-muted-foreground">
                Ask questions about the app
              </span>
            </div>
          </div>
        </SelectItem>
        <SelectItem value="agent">
          <div className="flex items-start gap-2">
            <Plug className="h-4 w-4 mt-0.5 shrink-0 text-purple-600 dark:text-purple-400" />
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-1.5">
                <span className="font-medium">Build with MCP</span>
              </div>
              <span className="text-xs text-muted-foreground">
                Like Build, but can use tools (MCP) to generate code
              </span>
            </div>
          </div>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
