import React, { useState } from "react";
import type { QueuedMessageItem } from "@/atoms/chatAtoms";
import {
  ChevronDown,
  ChevronUp,
  ListOrdered,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  Paperclip,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface QueuedMessagesListProps {
  messages: QueuedMessageItem[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  isStreaming: boolean;
  hasError: boolean;
}

interface QueuedMessageItemRowProps {
  message: QueuedMessageItem;
  index: number;
  total: number;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function QueuedMessageItemRow({
  message,
  index,
  total,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: QueuedMessageItemRowProps) {
  return (
    <li className="flex items-center gap-2 text-sm py-1.5 px-2 bg-muted/50 rounded group">
      {/* Message preview */}
      <span className="flex-1 truncate">{message.prompt}</span>

      {/* Attachment indicator if present */}
      {message.attachments && message.attachments.length > 0 && (
        <Paperclip size={14} className="text-muted-foreground flex-shrink-0" />
      )}

      {/* Action buttons - visible on hover */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={onEdit}
          className="p-1 hover:bg-muted rounded cursor-pointer"
          title="Edit"
        >
          <Pencil size={14} className="text-muted-foreground" />
        </button>
        <button
          type="button"
          onClick={onMoveUp}
          disabled={index === 0}
          className={cn(
            "p-1 hover:bg-muted rounded cursor-pointer",
            index === 0 && "opacity-30 cursor-not-allowed",
          )}
          title="Move up"
        >
          <ArrowUp size={14} className="text-muted-foreground" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={index === total - 1}
          className={cn(
            "p-1 hover:bg-muted rounded cursor-pointer",
            index === total - 1 && "opacity-30 cursor-not-allowed",
          )}
          title="Move down"
        >
          <ArrowDown size={14} className="text-muted-foreground" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="p-1 hover:bg-muted rounded cursor-pointer"
          title="Delete"
        >
          <Trash2 size={14} className="text-red-500" />
        </button>
      </div>
    </li>
  );
}

export function QueuedMessagesList({
  messages,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  isStreaming,
  hasError,
}: QueuedMessagesListProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!messages.length) return null;

  const statusText = hasError
    ? "will send after a successful response"
    : isStreaming
      ? "will send after current response"
      : "ready to send";

  return (
    <div className="border-b border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <ListOrdered className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm">{messages.length} Queued</span>
          <span className="text-xs text-muted-foreground">- {statusText}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {isExpanded && (
        <ul className="px-3 pb-2.5 space-y-1.5">
          {messages.map((msg, index) => (
            <QueuedMessageItemRow
              key={msg.id}
              message={msg}
              index={index}
              total={messages.length}
              onEdit={() => onEdit(msg.id)}
              onDelete={() => onDelete(msg.id)}
              onMoveUp={() => onMoveUp(msg.id)}
              onMoveDown={() => onMoveDown(msg.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
