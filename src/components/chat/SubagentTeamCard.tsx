import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Loader2,
  SearchCheck,
  Wrench,
} from "lucide-react";

import { AutoFixReviewIssuesSwitch } from "@/components/settings/SubagentSettings";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSettings";
import { useStreamChat } from "@/hooks/useStreamChat";
import { ipc, type SubagentThreadSummary } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { isDyadProEnabled } from "@/lib/schemas";
import { showError } from "@/lib/toast";

export function SubagentTeamCard({
  chatId,
  messageId,
}: {
  chatId: number;
  messageId: number;
}) {
  const { settings } = useSettings();
  const { streamMessage } = useStreamChat();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.subagents.byChat({ chatId });
  const [expanded, setExpanded] = useState(true);
  const [, setNow] = useState(Date.now());
  const isPro = settings ? isDyadProEnabled(settings) : false;
  const query = useQuery({
    queryKey,
    queryFn: () => ipc.agent.listSubagents({ chatId }),
    enabled: isPro,
  });
  const invalidateThreads = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.subagents.all });
  const startReviewMutation = useMutation({
    mutationFn: () =>
      ipc.agent.startReview({ chatId, sourceMessageId: messageId }),
    onSuccess: invalidateThreads,
    onError: (error) => showError(error),
  });
  const fixReviewMutation = useMutation({
    mutationFn: async (thread: SubagentThreadSummary) => {
      const { prompt } = await ipc.agent.fixReviewFindings({
        chatId,
        threadId: thread.id,
      });
      const remediated = await new Promise<"completed" | "failed" | "paused">(
        (resolve) => {
          void streamMessage({
            prompt,
            chatId,
            requestedChatMode: "local-agent",
            suppressAutoReview: true,
            onSettled: ({ success, pausedByStepLimit }) =>
              resolve(
                pausedByStepLimit ? "paused" : success ? "completed" : "failed",
              ),
          });
        },
      );
      if (remediated === "paused") return;
      if (remediated === "completed") {
        await ipc.agent.runAutoReviewBarrier({ chatId, verification: true });
      } else {
        await ipc.agent.skipReviewAutoFix({ chatId, threadId: thread.id });
      }
    },
    onSuccess: invalidateThreads,
    onError: (error) => showError(error),
  });
  const skipAutoFixMutation = useMutation({
    mutationFn: (threadId: string) =>
      ipc.agent.skipReviewAutoFix({ chatId, threadId }),
    onSuccess: invalidateThreads,
    onError: (error) => showError(error),
  });

  useEffect(
    () =>
      ipc.events.agent.onSubagentUpdate((event) => {
        if (event.chatId === chatId)
          void queryClient.invalidateQueries({
            queryKey: queryKeys.subagents.byChat({ chatId }),
          });
      }),
    [chatId, queryClient],
  );
  useEffect(() => {
    const activeDeadlines =
      query.data
        ?.map((thread) => thread.autoFixAt?.getTime())
        .filter((deadline): deadline is number =>
          deadline ? deadline > Date.now() : false,
        ) ?? [];
    if (activeDeadlines.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setNow(now);
      if (activeDeadlines.every((deadline) => deadline <= now)) {
        clearInterval(timer);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [query.data]);

  if (!isPro) return null;
  const threads = query.data ?? [];
  const visibleThreads = threads.filter(
    (thread) =>
      thread.persona !== "reviewer" || thread.sourceMessageId === messageId,
  );
  const review = threads.find(
    (thread) =>
      thread.persona === "reviewer" && thread.sourceMessageId === messageId,
  );
  const findingCount = Number(review?.result?.findingCount ?? 0);
  const report =
    typeof review?.result?.report === "string" ? review.result.report : null;

  return (
    <div className="mt-3 rounded-lg border bg-muted/20 text-sm">
      <div className="flex items-center justify-between gap-2 p-2">
        <button
          className="flex items-center gap-2 font-medium"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <Bot className="h-4 w-4" /> Agent team
          {visibleThreads.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {visibleThreads.length}
            </span>
          )}
        </button>
        <Button
          size="sm"
          variant="outline"
          disabled={
            startReviewMutation.isPending ||
            review?.status === "running" ||
            review?.status === "queued"
          }
          onClick={() => startReviewMutation.mutate()}
        >
          {review?.status === "running" || review?.status === "queued" ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <SearchCheck className="mr-1 h-4 w-4" />
          )}
          {review ? review.taskName : "Review changes"}
        </Button>
      </div>
      {expanded && visibleThreads.length > 0 && (
        <div className="space-y-2 border-t p-2">
          {visibleThreads.map((thread) => (
            <div key={thread.id} className="rounded-md bg-background p-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-medium capitalize">
                    {thread.persona}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {thread.taskName}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {statusLabel(thread)}
                </span>
              </div>
              {(thread.inputTokens > 0 || thread.outputTokens > 0) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {(thread.inputTokens + thread.outputTokens).toLocaleString()}{" "}
                  tokens · {thread.toolCallCount} tool calls
                </p>
              )}
              {thread.error && (
                <p className="mt-1 text-xs text-destructive">{thread.error}</p>
              )}
              {thread.persona === "reviewer" && thread.autoFixAt && (
                <div className="mt-2 flex items-center justify-between rounded bg-amber-500/10 p-2 text-xs">
                  <span>
                    Fixing findings in{" "}
                    {Math.max(
                      0,
                      Math.ceil(
                        (thread.autoFixAt.getTime() - Date.now()) / 1000,
                      ),
                    )}
                    …
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={skipAutoFixMutation.isPending}
                    onClick={() => skipAutoFixMutation.mutate(thread.id)}
                  >
                    Skip fix
                  </Button>
                </div>
              )}
              {thread.persona === "reviewer" &&
                report &&
                thread.id === review?.id && (
                  <div className="mt-2 space-y-2">
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                      {report}
                    </pre>
                    {findingCount > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          disabled={fixReviewMutation.isPending}
                          onClick={() => fixReviewMutation.mutate(thread)}
                        >
                          <Wrench className="mr-1 h-4 w-4" />
                          Fix findings ({findingCount})
                        </Button>
                        <AutoFixReviewIssuesSwitch compact />
                      </div>
                    )}
                  </div>
                )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function statusLabel(thread: SubagentThreadSummary): string {
  if (thread.status === "completed" && thread.persona === "reviewer") {
    const count = Number(thread.result?.findingCount ?? 0);
    return count === 0
      ? "No findings"
      : `${count} finding${count === 1 ? "" : "s"}`;
  }
  return thread.status.replaceAll("_", " ");
}
