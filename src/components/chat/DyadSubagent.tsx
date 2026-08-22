import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleX,
  TriangleAlert,
  Loader2,
  Square,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ipc, isSubagentActive, type SubagentStatus } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";
import {
  DyadCard,
  DyadCardHeader,
  DyadCardPresentationContext,
} from "./DyadCardPrimitives";

interface DyadSubagentProps {
  chatId: number;
  threadId: string;
  persona: string;
  taskName: string;
  renderActivity: (
    xml: string,
    activityId: number,
    status: "pending" | "completed" | "error" | "aborted",
  ) => ReactNode;
}

export function DyadSubagent({
  chatId,
  threadId,
  persona,
  taskName,
  renderActivity,
}: DyadSubagentProps) {
  const queryClient = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(false);
  const wasActive = useRef(false);
  const threadsQuery = useQuery({
    queryKey: queryKeys.subagents.byChat({ chatId }),
    queryFn: () => ipc.agent.listSubagents({ chatId }),
  });
  const activitiesQuery = useQuery({
    queryKey: queryKeys.subagents.activities({ chatId, threadId }),
    queryFn: () => ipc.agent.getSubagentActivities({ chatId, threadId }),
  });
  const thread = threadsQuery.data?.find((item) => item.id === threadId);
  const activities = activitiesQuery.data ?? [];
  const isActive = thread ? isSubagentActive(thread.status) : false;

  useEffect(() => {
    return ipc.events.agent.onSubagentUpdate((event) => {
      if (event.chatId !== chatId || event.threadId !== threadId) return;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.subagents.byChat({ chatId }),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.subagents.activities({ chatId, threadId }),
      });
    });
  }, [chatId, queryClient, threadId]);

  useEffect(() => {
    if (isActive) setIsExpanded(true);
    else if (wasActive.current) setIsExpanded(false);
    wasActive.current = isActive;
  }, [isActive]);

  const cancelMutation = useMutation({
    mutationFn: () => ipc.agent.cancelSubagent({ chatId, threadId }),
    onError: (error) => showError(error),
  });
  const latestActivity = activities.at(-1);
  const loadError = threadsQuery.isError || activitiesQuery.isError;
  const report =
    typeof thread?.result?.report === "string" ? thread.result.report : null;
  const title = taskName || thread?.taskName || "Sub-agent task";
  const statusText = useMemo(
    () =>
      loadError
        ? "Could not load"
        : getStatusText(thread?.status, latestActivity?.toolName),
    [latestActivity?.toolName, loadError, thread?.status],
  );

  return (
    <DyadCard className="overflow-hidden">
      <DyadCardHeader icon={<Bot size={15} />} accentColor="indigo">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((value) => !value)}
        >
          <ChevronRight
            size={16}
            className={`shrink-0 text-muted-foreground transition-transform duration-200 ${
              isExpanded ? "rotate-90" : ""
            }`}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{title}</span>
            <span className="block truncate text-xs text-muted-foreground">
              <span className="capitalize">{persona}</span>
              {statusText ? ` · ${statusText}` : ""}
              {activities.length > 0
                ? ` · ${activities.length} action${activities.length === 1 ? "" : "s"}`
                : ""}
            </span>
          </span>
        </button>
        {isActive ? (
          <Loader2
            size={15}
            className="shrink-0 animate-spin text-amber-600 dark:text-amber-400"
          />
        ) : thread?.status === "completed" ? (
          <CheckCircle2 size={15} className="shrink-0 text-green-600" />
        ) : thread && isSubagentWarningStatus(thread.status) ? (
          <TriangleAlert
            size={15}
            className="shrink-0 text-amber-600 dark:text-amber-400"
          />
        ) : thread ? (
          <CircleX size={15} className="shrink-0 text-destructive" />
        ) : null}
        {isActive && thread?.status !== "stopping" && (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Stop ${persona} ${title}`}
            disabled={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
          >
            {cancelMutation.isPending ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <Square className="mr-1 size-3" />
            )}
            Stop
          </Button>
        )}
      </DyadCardHeader>

      {isExpanded && (
        <div className="border-t border-border/60 px-3 py-2">
          {loadError ? (
            <div className="flex items-center justify-between gap-2 py-1">
              <p className="text-xs text-destructive">
                Could not load agent activity.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void threadsQuery.refetch();
                  void activitiesQuery.refetch();
                }}
              >
                Retry
              </Button>
            </div>
          ) : activitiesQuery.isPending ? (
            <p className="py-2 text-xs text-muted-foreground">
              Loading agent activity…
            </p>
          ) : activities.length > 0 ? (
            <DyadCardPresentationContext.Provider value="embedded">
              <div className="space-y-0.5">
                {activities.map((activity) => (
                  <div key={activity.id} className="relative">
                    {activity.presentationXml ? (
                      renderActivity(
                        withActivityState(
                          activity.presentationXml,
                          activity.status,
                        ),
                        activity.id,
                        activity.status,
                      )
                    ) : (
                      <p className="py-1.5 text-xs text-muted-foreground">
                        Used {formatToolName(activity.toolName)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </DyadCardPresentationContext.Provider>
          ) : isActive ? (
            <p className="py-2 text-xs text-muted-foreground">
              The agent is getting started…
            </p>
          ) : null}

          {thread?.error && (
            <p className="mt-2 text-xs text-destructive">{thread.error}</p>
          )}
          {report && (
            <div className="mt-2 border-t border-border/60 pt-2">
              <p className="mb-1 text-xs font-medium">Findings</p>
              <div className="max-h-72 overflow-y-auto whitespace-pre-wrap text-xs text-foreground/85">
                {report}
              </div>
            </div>
          )}
        </div>
      )}
    </DyadCard>
  );
}

function getStatusText(
  status: SubagentStatus | undefined,
  toolName: string | undefined,
): string {
  if (status === "running" && toolName)
    return `Using ${formatToolName(toolName)}`;
  if (!status) return "Starting";
  if (status === "completed") return "Completed";
  if (status === "partial") return "Partial findings";
  if (status === "stopping") return "Stop requested · tool still finishing";
  return status.replaceAll("_", " ");
}

function isSubagentWarningStatus(status: SubagentStatus): boolean {
  return ["partial", "review_outdated", "cancelled"].includes(status);
}

function formatToolName(toolName: string): string {
  return toolName.replaceAll("_", " ");
}

function withActivityState(
  xml: string,
  status: "pending" | "completed" | "error" | "aborted",
): string {
  const state = status === "completed" ? "finished" : status;
  return xml.replace(/^(<dyad-[\w-]+)/, `$1 state="${state}"`);
}
