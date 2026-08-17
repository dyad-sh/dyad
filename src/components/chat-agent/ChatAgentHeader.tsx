import {
  ArrowLeft,
  ChevronDown,
  History,
  MessageSquare,
  PanelRight,
  Plus,
  Share,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { showInfo } from "@/lib/toast";
import type { ChatAgentConversation } from "./types";

export function ChatAgentHeader({
  title,
  onNewChat,
  onOpenHistory,
  conversations = [],
  activeId,
  onSelectConversation,
  onBack,
}: {
  title: string;
  onNewChat: () => void;
  onOpenHistory: () => void;
  conversations?: ChatAgentConversation[];
  activeId?: string;
  onSelectConversation?: (conversation: ChatAgentConversation) => void;
  onBack?: () => void;
}) {
  return (
    <header className="chat-agent-header" data-testid="chat-agent-header">
      {onBack && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="chat-agent-header-btn mr-1 size-8"
          aria-label="Back to Agents"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          className="chat-agent-title-trigger font-jarvis-ui"
          data-testid="chat-agent-title"
        >
          <span className="truncate max-w-[min(100%,280px)]">{title}</span>
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuItem onClick={onNewChat}>
            <Plus className="size-4" />
            New conversation
          </DropdownMenuItem>
          {conversations.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Recent conversations
              </DropdownMenuLabel>
              {[...conversations]
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .slice(0, 8)
                .map((conversation) => (
                  <DropdownMenuItem
                    key={conversation.id}
                    onClick={() => onSelectConversation?.(conversation)}
                    className="min-w-0 py-2"
                  >
                    <MessageSquare className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {conversation.title}
                    </span>
                    {conversation.id === activeId && (
                      <span className="text-[10px] text-primary">Open</span>
                    )}
                  </DropdownMenuItem>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onOpenHistory}>
                <History className="size-4" />
                Manage all conversations…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="chat-agent-header-actions">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="chat-agent-header-btn size-8"
          aria-label="Conversation history"
          data-testid="chat-agent-history-button"
          onClick={onOpenHistory}
        >
          <History className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="chat-agent-header-btn"
          onClick={() => showInfo("Share is coming soon.")}
        >
          <Share className="size-4" />
          Share
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="chat-agent-header-btn size-8"
          aria-label="Panel"
          onClick={() => showInfo("Artifacts panel coming soon.")}
        >
          <PanelRight className="size-4" />
        </Button>
      </div>
    </header>
  );
}
