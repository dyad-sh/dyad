/**
 * Email Message List
 *
 * Center column showing the message list for the selected folder.
 * Includes message preview rows with AI priority indicators.
 */

import { useMemo } from "react";
import {
  Star,
  Paperclip,
  AlertTriangle,
  ArrowUp,
  Minus,
  ArrowDown,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useEmailMessages,
  useUnifiedMessages,
  useMarkRead,
  useMarkStarred,
} from "@/hooks/useEmail";
import type { EmailMessage, EmailPriority, EmailCategory } from "@/types/email_types";

const PRIORITY_ICONS: Record<
  EmailPriority,
  { icon: typeof ArrowUp; color: string }
> = {
  urgent: { icon: AlertTriangle, color: "text-red-500" },
  high: { icon: ArrowUp, color: "text-orange-500" },
  normal: { icon: Minus, color: "text-muted-foreground" },
  low: { icon: ArrowDown, color: "text-blue-400" },
};

const CATEGORY_COLORS: Partial<Record<EmailCategory, string>> = {
  action_required: "bg-red-500/15 text-red-600",
  fyi: "bg-blue-500/15 text-blue-600",
  newsletter: "bg-purple-500/15 text-purple-600",
  promotional: "bg-yellow-500/15 text-yellow-600",
  finance: "bg-green-500/15 text-green-600",
  travel: "bg-cyan-500/15 text-cyan-600",
  calendar: "bg-amber-500/15 text-amber-600",
};

interface EmailMessageListProps {
  accountId: string | null;
  folder: string;
  selectedMessageId: number | null;
  onSelectMessage: (id: number) => void;
}

export function EmailMessageList({
  accountId,
  folder,
  selectedMessageId,
  onSelectMessage,
}: EmailMessageListProps) {
  // If no account selected, show unified inbox
  const accountMessages = useEmailMessages(accountId ?? "", folder, {
    limit: 100,
  });
  const unifiedMessages = useUnifiedMessages(folder, { limit: 100 });

  const { data: messages = [], isLoading } = accountId
    ? accountMessages
    : unifiedMessages;

  const markRead = useMarkRead();
  const markStarred = useMarkStarred();

  const handleSelect = (msg: EmailMessage) => {
    onSelectMessage(msg.id);
    if (!msg.isRead) {
      markRead.mutate({ messageId: msg.id, read: true });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex gap-3 rounded-lg p-2">
            <Skeleton className="h-4 w-4 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-2 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No messages
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="divide-y divide-border/30">
        {(messages as EmailMessage[]).map((msg) => (
          <MessageRow
            key={msg.id}
            message={msg}
            isSelected={msg.id === selectedMessageId}
            onSelect={() => handleSelect(msg)}
            onToggleStar={() =>
              markStarred.mutate({
                messageId: msg.id,
                starred: !msg.isStarred,
              })
            }
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function MessageRow({
  message,
  isSelected,
  onSelect,
  onToggleStar,
}: {
  message: EmailMessage;
  isSelected: boolean;
  onSelect: () => void;
  onToggleStar: () => void;
}) {
  const date = useMemo(() => {
    const d = new Date(message.date);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }, [message.date]);

  const priorityInfo = message.priority
    ? PRIORITY_ICONS[message.priority]
    : null;
  const PriorityIcon = priorityInfo?.icon;

  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors",
        isSelected
          ? "bg-emerald-500/10 border-l-2 border-emerald-500"
          : "hover:bg-muted/30",
        !message.isRead && "bg-muted/20",
      )}
      onClick={onSelect}
    >
      {/* Star */}
      <button
        type="button"
        className="mt-0.5 shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          onToggleStar();
        }}
      >
        <Star
          className={cn(
            "h-3.5 w-3.5",
            message.isStarred
              ? "fill-yellow-400 text-yellow-400"
              : "text-muted-foreground/40",
          )}
        />
      </button>

      {/* Priority */}
      {PriorityIcon && (
        <PriorityIcon
          className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", priorityInfo.color)}
        />
      )}

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span
            className={cn(
              "truncate text-sm",
              !message.isRead ? "font-semibold text-foreground" : "text-foreground/70",
            )}
          >
            {message.from?.name || message.from?.address || "Unknown"}
          </span>
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
            {date}
          </span>
        </div>
        <div
          className={cn(
            "truncate text-xs",
            !message.isRead
              ? "font-medium text-foreground/80"
              : "text-foreground/60",
          )}
        >
          {message.subject}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="truncate text-[11px] text-muted-foreground">
            {message.snippet?.slice(0, 80)}
          </span>
          {message.hasAttachments && (
            <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
        </div>

        {/* AI badges */}
        {(message.aiCategory || message.aiSummary) && (
          <div className="mt-1 flex items-center gap-1">
            {message.aiCategory && message.aiCategory !== "uncategorized" && (
              <Badge
                variant="secondary"
                className={cn(
                  "text-[9px] h-4 px-1.5",
                  CATEGORY_COLORS[message.aiCategory] ?? "",
                )}
              >
                {message.aiCategory.replace("_", " ")}
              </Badge>
            )}
            {message.aiSummary && (
              <Sparkles className="h-3 w-3 text-amber-400" />
            )}
          </div>
        )}
      </div>
    </button>
  );
}
