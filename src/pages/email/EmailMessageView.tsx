/**
 * Email Message View
 *
 * Right column showing full message content with AI panel.
 */

import { useState } from "react";
import {
  Reply,
  Forward,
  Trash2,
  Archive,
  Star,
  MoreHorizontal,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Calendar,
  AlertTriangle,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useEmailMessage,
  useMarkRead,
  useMarkStarred,
  useDeleteMessage,
  useMoveMessage,
  useTriageMessage,
  useSummarizeMessages,
  useSmartReplies,
  useDetectFollowUps,
} from "@/hooks/useEmail";
import type { EmailMessage, FollowUp } from "@/types/email_types";

interface EmailMessageViewProps {
  messageId: number | null;
  onReply: (msg: EmailMessage) => void;
  onForward: (msg: EmailMessage) => void;
}

export function EmailMessageView({
  messageId,
  onReply,
  onForward,
}: EmailMessageViewProps) {
  const { data: message, isLoading } = useEmailMessage(messageId);
  const [showAiPanel, setShowAiPanel] = useState(false);

  if (!messageId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a message to read
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-px w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!message) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Message not found
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <MessageHeader
        message={message as EmailMessage}
        onReply={() => onReply(message as EmailMessage)}
        onForward={() => onForward(message as EmailMessage)}
        onToggleAi={() => setShowAiPanel((p) => !p)}
        showAiPanel={showAiPanel}
      />
      <Separator />
      <div className="flex flex-1 overflow-hidden">
        <ScrollArea className="flex-1">
          <MessageBody message={message as EmailMessage} />
        </ScrollArea>
        {showAiPanel && (
          <div className="w-72 border-l border-border/50">
            <AiSidePanel message={message as EmailMessage} />
          </div>
        )}
      </div>
    </div>
  );
}

function MessageHeader({
  message,
  onReply,
  onForward,
  onToggleAi,
  showAiPanel,
}: {
  message: EmailMessage;
  onReply: () => void;
  onForward: () => void;
  onToggleAi: () => void;
  showAiPanel: boolean;
}) {
  const markStarred = useMarkStarred();
  const deleteMsg = useDeleteMessage();
  const moveMsg = useMoveMessage();

  const fromStr = message.from?.name
    ? `${message.from.name} <${message.from.address}>`
    : message.from?.address ?? "Unknown";
  const toStr = message.to?.map((a) => a.name || a.address).join(", ") ?? "";
  const dateStr = new Date(message.date).toLocaleString();

  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground leading-tight">
            {message.subject}
          </h2>
          <div className="mt-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{fromStr}</span>
            <span className="mx-1">→</span>
            <span>{toStr}</span>
          </div>
          <div className="text-[10px] text-muted-foreground">{dateStr}</div>
        </div>

        {/* AI badges */}
        {message.priority && message.priority !== "normal" && (
          <Badge
            variant="secondary"
            className={cn(
              "text-[10px] shrink-0",
              message.priority === "urgent"
                ? "bg-red-500/15 text-red-600"
                : message.priority === "high"
                  ? "bg-orange-500/15 text-orange-600"
                  : "bg-blue-500/15 text-blue-600",
            )}
          >
            {message.priority}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-1 mt-1">
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={onReply}>
          <Reply className="h-3.5 w-3.5" /> Reply
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={onForward}>
          <Forward className="h-3.5 w-3.5" /> Forward
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() =>
            markStarred.mutate({
              messageId: message.id,
              starred: !message.isStarred,
            })
          }
        >
          <Star
            className={cn(
              "h-3.5 w-3.5",
              message.isStarred
                ? "fill-yellow-400 text-yellow-400"
                : "text-muted-foreground",
            )}
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() =>
            moveMsg.mutate({ messageId: message.id, toFolder: "archive" })
          }
        >
          <Archive className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-red-500 hover:text-red-600"
          onClick={() => deleteMsg.mutate(message.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>

        <div className="flex-1" />

        <Button
          variant={showAiPanel ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={onToggleAi}
        >
          <Sparkles className="h-3.5 w-3.5" /> AI
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => moveMsg.mutate({ messageId: message.id, toFolder: "spam" })}>
              <AlertTriangle className="h-3.5 w-3.5 mr-2" /> Mark as spam
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => moveMsg.mutate({ messageId: message.id, toFolder: "archive" })}>
              <Archive className="h-3.5 w-3.5 mr-2" /> Archive
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function MessageBody({ message }: { message: EmailMessage }) {
  if (message.bodyHtml) {
    return (
      <div className="p-4">
        <div
          className="prose prose-sm dark:prose-invert max-w-none"
          // biome-ignore lint: email HTML content display
          dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
        />
      </div>
    );
  }

  return (
    <div className="p-4 whitespace-pre-wrap text-sm text-foreground/80">
      {message.bodyPlain ?? message.snippet}
    </div>
  );
}

function AiSidePanel({ message }: { message: EmailMessage }) {
  const triage = useTriageMessage();
  const summarize = useSummarizeMessages();
  const followUps = useDetectFollowUps();
  const { data: smartReplies } = useSmartReplies(message.id);

  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
          <Sparkles className="h-3.5 w-3.5 text-amber-400" />
          AI Assistant
        </h3>

        {/* Quick Actions */}
        <div className="space-y-1.5">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start text-xs h-7"
            onClick={() => triage.mutate(message.id)}
            disabled={triage.isPending}
          >
            <AlertTriangle className="h-3 w-3 mr-1.5" />
            {triage.isPending ? "Triaging..." : "Triage"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start text-xs h-7"
            onClick={() => summarize.mutate([message.id])}
            disabled={summarize.isPending}
          >
            <ChevronDown className="h-3 w-3 mr-1.5" />
            {summarize.isPending ? "Summarizing..." : "Summarize"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start text-xs h-7"
            onClick={() => followUps.mutate(message.id)}
            disabled={followUps.isPending}
          >
            <Calendar className="h-3 w-3 mr-1.5" />
            {followUps.isPending ? "Detecting..." : "Follow-ups"}
          </Button>
        </div>

        {/* Triage Result */}
        {triage.data && (
          <div className="rounded-md border border-border/50 p-2 space-y-1">
            <div className="text-[10px] font-semibold text-foreground/60 uppercase">
              Triage
            </div>
            <div className="flex gap-1 flex-wrap">
              <Badge variant="secondary" className="text-[9px] h-4">
                {triage.data.priority}
              </Badge>
              <Badge variant="secondary" className="text-[9px] h-4">
                {triage.data.category}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {triage.data.reason}
            </p>
            {triage.data.suggestedActions.length > 0 && (
              <div className="text-[11px]">
                <span className="font-medium">Suggested:</span>{" "}
                {triage.data.suggestedActions.join(", ")}
              </div>
            )}
          </div>
        )}

        {/* Summary Result */}
        {summarize.data && (
          <div className="rounded-md border border-border/50 p-2 space-y-1">
            <div className="text-[10px] font-semibold text-foreground/60 uppercase">
              Summary
            </div>
            <p className="text-[11px] text-foreground/80">
              {summarize.data.summary}
            </p>
            {summarize.data.actionItems.length > 0 && (
              <div>
                <div className="text-[10px] font-medium mt-1">
                  Action Items:
                </div>
                <ul className="list-disc list-inside text-[11px] text-muted-foreground">
                  {summarize.data.actionItems.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Follow-ups */}
        {followUps.data && followUps.data.length > 0 && (
          <div className="rounded-md border border-border/50 p-2 space-y-1">
            <div className="text-[10px] font-semibold text-foreground/60 uppercase">
              Follow-ups
            </div>
            {followUps.data.map((fu: FollowUp, i: number) => (
              <div key={i} className="text-[11px] text-foreground/80">
                <span className="font-medium">{fu.commitment}</span>
                {fu.dueDate && (
                  <span className="text-muted-foreground ml-1">
                    by {new Date(fu.dueDate).toLocaleDateString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Smart Replies */}
        {smartReplies && smartReplies.length > 0 && (
          <div className="rounded-md border border-border/50 p-2 space-y-1">
            <div className="text-[10px] font-semibold text-foreground/60 uppercase">
              Quick Replies
            </div>
            {smartReplies.map((reply, i) => (
              <Button
                key={i}
                variant="outline"
                size="sm"
                className="w-full text-xs h-auto py-1.5 text-left whitespace-normal justify-start"
              >
                <Send className="h-3 w-3 mr-1.5 shrink-0" />
                <span className="line-clamp-2">{reply}</span>
              </Button>
            ))}
          </div>
        )}

        {/* Existing AI Summary */}
        {message.aiSummary && !summarize.data && (
          <div className="rounded-md border border-border/50 p-2">
            <div className="text-[10px] font-semibold text-foreground/60 uppercase">
              AI Summary
            </div>
            <p className="text-[11px] text-foreground/80 mt-0.5">
              {message.aiSummary}
            </p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
