/**
 * Agent Action Queue
 *
 * Displays pending agent actions that need user approval,
 * with approve/reject controls.
 */

import { Bot, Check, X, Send, Archive, Trash2, FolderInput, Tag, MailOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  usePendingActions,
  useApproveAction,
  useRejectAction,
} from "@/hooks/useEmail";
import type { EmailAgentAction } from "@/types/email_types";

interface AgentActionQueueProps {
  accountId: string;
}

const ACTION_ICONS: Record<string, typeof Send> = {
  send: Send,
  reply: Send,
  forward: Send,
  archive: Archive,
  delete: Trash2,
  move: FolderInput,
  label: Tag,
  mark_read: MailOpen,
};

const ACTION_COLORS: Record<string, string> = {
  send: "text-blue-500",
  reply: "text-blue-500",
  forward: "text-blue-500",
  archive: "text-amber-500",
  delete: "text-red-500",
  move: "text-purple-500",
  label: "text-emerald-500",
  mark_read: "text-muted-foreground",
};

export function AgentActionQueue({ accountId }: AgentActionQueueProps) {
  const pending = usePendingActions(accountId);
  const approve = useApproveAction();
  const reject = useRejectAction();

  const actions = pending.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-emerald-500" />
          <span className="text-sm font-semibold">Agent Queue</span>
        </div>
        {actions.length > 0 && (
          <Badge variant="secondary" className="h-5 text-xs">
            {actions.length}
          </Badge>
        )}
      </div>

      <ScrollArea className="flex-1">
        {actions.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <Bot className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No pending actions
            </p>
          </div>
        )}

        <div className="space-y-1 p-2">
          {actions.map((action: EmailAgentAction) => {
            const Icon = ACTION_ICONS[action.actionType] ?? Bot;
            const color = ACTION_COLORS[action.actionType] ?? "text-muted-foreground";

            return (
              <div
                key={action.id}
                className="flex items-start gap-2 rounded-md border border-border/30 p-2.5"
              >
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium capitalize">
                      {action.actionType.replace("_", " ")}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {action.createdAt
                        ? new Date(action.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                    {action.result || JSON.stringify(action.payload).slice(0, 100)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-emerald-500 hover:bg-emerald-500/10"
                    onClick={() => approve.mutate(action.id!)}
                    disabled={approve.isPending || !action.id}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-red-500 hover:bg-red-500/10"
                    onClick={() => reject.mutate(action.id!)}
                    disabled={reject.isPending || !action.id}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
