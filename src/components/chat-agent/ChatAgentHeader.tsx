import {
  ArrowLeft,
  ChevronDown,
  History,
  PanelRight,
  Share,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { showInfo } from "@/lib/toast";

export function ChatAgentHeader({
  title,
  onNewChat,
  onOpenHistory,
  onBack,
}: {
  title: string;
  onNewChat: () => void;
  onOpenHistory: () => void;
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
        <DropdownMenuContent align="start" className="min-w-48">
          <DropdownMenuItem onClick={onNewChat}>
            New conversation
          </DropdownMenuItem>
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
