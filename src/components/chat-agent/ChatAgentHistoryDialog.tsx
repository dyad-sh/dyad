import { useMemo } from "react";
import { MessagesSquare, Trash2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ChatAgentConversation } from "./types";

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function ChatAgentHistoryDialog({
  open,
  onOpenChange,
  conversations,
  activeId,
  onSelect,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: ChatAgentConversation[];
  activeId: string;
  onSelect: (conversation: ChatAgentConversation) => void;
  onDelete: (id: string) => void;
}) {
  const sorted = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[92vw] max-w-lg gap-0 overflow-hidden border-cyan-500/20 bg-[#0a1628] p-0 text-cyan-50"
        data-testid="chat-agent-history-dialog"
      >
        <DialogHeader className="border-b border-cyan-500/15 px-5 py-4">
          <DialogTitle className="font-jarvis-ui text-base tracking-wide text-cyan-50">
            Conversation history
          </DialogTitle>
          <DialogDescription className="text-xs text-cyan-100/50">
            {conversations.length === 0
              ? "Your past conversations will appear here."
              : `${conversations.length} saved conversation${
                  conversations.length === 1 ? "" : "s"
                }`}
          </DialogDescription>
        </DialogHeader>

        {sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <MessagesSquare className="size-8 text-cyan-400/40" />
            <p className="text-sm text-cyan-100/55">No conversations yet</p>
          </div>
        ) : (
          <ul className="max-h-[60vh] overflow-y-auto p-2 scrollbar-on-hover">
            {sorted.map((conversation) => {
              const isActive = conversation.id === activeId;
              const messageCount = conversation.messages.length;
              return (
                <li key={conversation.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    data-testid="chat-agent-history-item"
                    onClick={() => onSelect(conversation)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(conversation);
                      }
                    }}
                    className={cn(
                      "group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
                      "hover:bg-cyan-500/10",
                      isActive && "bg-cyan-500/15",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-cyan-50">
                        {conversation.title}
                      </p>
                      <p className="mt-0.5 text-xs text-cyan-100/45">
                        {formatRelativeTime(conversation.updatedAt)} ·{" "}
                        {messageCount} message{messageCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Delete conversation"
                      data-testid="chat-agent-history-delete"
                      className="shrink-0 rounded-md p-1.5 text-cyan-100/40 opacity-0 transition-colors hover:bg-red-500/15 hover:text-red-300 focus-visible:opacity-100 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(conversation.id);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
