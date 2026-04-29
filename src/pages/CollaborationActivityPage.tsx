/**
 * Collaboration Activity Page
 *
 * Chronological flat feed of every cross-agent message and task transition,
 * across every channel. Polled every 4s. Read-only.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowLeft,
  Bot,
  CheckCircle2,
  CircleDot,
  Hash,
  ListChecks,
  Loader2,
  MessageSquare,
  XCircle,
  AlertCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  CollaborationHubClient,
  type CollabActivityItem,
  type CollabTaskStatus,
} from "@/ipc/collaboration_hub_client";

const POLL_INTERVAL_MS = 4_000;

const AGENT_PALETTE = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
];

function colorForAgent(agentId: number | null | undefined): string {
  if (agentId == null) return "#64748b";
  const n = ((agentId % AGENT_PALETTE.length) + AGENT_PALETTE.length) % AGENT_PALETTE.length;
  return AGENT_PALETTE[n];
}

function formatTime(unixSec: number): string {
  if (!unixSec) return "";
  return new Date(unixSec * 1000).toLocaleString();
}

function statusIcon(status: CollabTaskStatus) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case "rejected":
    case "cancelled":
      return <XCircle className="h-3.5 w-3.5 text-rose-500" />;
    case "in_progress":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />;
    case "accepted":
      return <CircleDot className="h-3.5 w-3.5 text-blue-500" />;
    default:
      return <AlertCircle className="h-3.5 w-3.5 text-slate-500" />;
  }
}

export function CollaborationActivityPage() {
  const activityQuery = useQuery<CollabActivityItem[]>({
    queryKey: ["collab", "activity"],
    queryFn: () => CollaborationHubClient.recentActivity({ limit: 100 }),
    refetchInterval: POLL_INTERVAL_MS,
    initialData: [],
  });

  const items = activityQuery.data ?? [];

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Collaboration Activity</h1>
            <p className="text-xs text-muted-foreground">
              Every recent inter-agent message and task transition
            </p>
          </div>
        </div>
        <Link
          to="/collaboration"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to channels
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {activityQuery.isLoading && items.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading activity…
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <Bot className="mb-2 h-8 w-8 opacity-40" />
            <p>No activity yet</p>
            <p className="text-xs">When agents start collaborating, you'll see events here.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((item, idx) =>
              item.kind === "message" ? (
                <li
                  key={`m-${item.message.id}-${idx}`}
                  className="flex items-start gap-3 rounded-md border bg-card/50 p-3"
                >
                  <div
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold uppercase text-white"
                    style={{ backgroundColor: colorForAgent(item.message.fromAgentId) }}
                  >
                    {item.message.fromAgentId == null
                      ? "·"
                      : String(item.message.fromAgentId).slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                        <MessageSquare className="mr-1 h-3 w-3" /> {item.message.kind}
                      </Badge>
                      <span className="font-medium">
                        {item.message.fromAgentId == null
                          ? "system"
                          : `agent #${item.message.fromAgentId}`}
                      </span>
                      {item.message.toAgentId != null ? (
                        <span className="text-muted-foreground">
                          → agent #{item.message.toAgentId}
                        </span>
                      ) : null}
                      {item.message.channelId != null ? (
                        <span className="inline-flex items-center text-muted-foreground">
                          <Hash className="h-3 w-3" /> channel {item.message.channelId}
                        </span>
                      ) : null}
                      <span className="ml-auto text-muted-foreground">{formatTime(item.at)}</span>
                    </div>
                    <div className="whitespace-pre-wrap break-words text-sm leading-snug">
                      {item.message.content}
                    </div>
                  </div>
                </li>
              ) : (
                <li
                  key={`t-${item.task.id}-${idx}`}
                  className="flex items-start gap-3 rounded-md border bg-card/50 p-3"
                >
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                    <ListChecks className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                        task {item.event}
                      </Badge>
                      {statusIcon(item.task.status)}
                      <span className="font-medium">{item.task.title}</span>
                      <span className="text-muted-foreground">
                        agent #{item.task.fromAgentId} → agent #{item.task.toAgentId}
                      </span>
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">
                        {item.task.priority}
                      </Badge>
                      <span className="ml-auto text-muted-foreground">{formatTime(item.at)}</span>
                    </div>
                    {item.task.description ? (
                      <p className="text-xs text-muted-foreground">{item.task.description}</p>
                    ) : null}
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CollaborationActivityPage;
