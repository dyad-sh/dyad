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
  PlayIcon,
  PauseIcon,
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
  isPaused: boolean;
  onPauseQueue: () => void;
  onResumeQueue: () => void;
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
  isPaused,
  onPauseQueue,
  onResumeQueue,
}: QueuedMessagesListProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!messages.length) return null;

  const statusText = hasError
    ? "will send after a successful response"
    : isStreaming
      ? "will send after current response"
      : "ready to send";

  return (
    <div
      data-testid="queue-header"
      className={cn(
        "border-b border-border bg-muted/30",
        isPaused && "bg-yellow-500/10 border-yellow-500/50",
      )}
    >
      <div className="w-full flex items-center justify-between px-3 py-2">
        {/* Make left header area clickable for expand/collapse */}
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setIsExpanded((v) => !v);
            }
          }}
          className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          onClick={() => setIsExpanded((v) => !v)}
          title={isExpanded ? "Collapse" : "Expand"}
        >
          <ListOrdered className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm">{messages.length} Queued</span>
          {!isPaused && (
            <span className="text-xs text-muted-foreground">
              - {statusText}
            </span>
          )}
          {isPaused && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 font-medium">
              Paused
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          <button
            type="button"
            onClick={isPaused ? onResumeQueue : onPauseQueue}
            aria-label={isPaused ? "Resume queue" : "Pause queue"}
            title={isPaused ? "Resume queue" : "Pause queue"}
            className={cn(
              "ml-2 px-2 py-1 rounded-lg transition-colors duration-150 cursor-pointer",
              isPaused
                ? "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/30"
                : "text-muted-foreground hover:text-primary hover:bg-muted/50",
            )}
          >
            {isPaused ? <PlayIcon size={18} /> : <PauseIcon size={18} />}
          </button>
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-muted rounded cursor-pointer"
            title={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
        </div>
      </div>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{
          gridTemplateRows: isExpanded ? "1fr" : "0fr",
        }}
      >
        <div className="overflow-hidden">
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
        </div>
      </div>
    </div>
  );
}
