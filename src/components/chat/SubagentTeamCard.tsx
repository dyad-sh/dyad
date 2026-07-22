import { useEffect, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Loader2,
  SearchCheck,
  Square,
  Wrench,
} from "lucide-react";

import { AutoFixReviewIssuesSwitch } from "@/components/settings/SubagentSettings";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSettings } from "@/hooks/useSettings";
import { useStreamChat } from "@/hooks/useStreamChat";
import {
  ipc,
  isSubagentAcceptingMessages,
  type SubagentThreadSummary,
} from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { isDyadProEnabled } from "@/lib/schemas";
import { showError } from "@/lib/toast";
import { setPendingReviewContinuation } from "@/hooks/subagentReviewContinuation";

const MAX_RENDERED_REPORT_CHARS = 100_000;

export function SubagentTeamCard({
  chatId,
  messageId,
  rootIsStreaming = false,
}: {
  chatId: number;
  messageId: number;
  rootIsStreaming?: boolean;
}) {
  const { settings } = useSettings();
  const { streamMessage } = useStreamChat();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.subagents.byChat({ chatId });
  const [expanded, setExpanded] = useState(true);
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>(
    {},
  );
  const [expandedThreadIds, setExpandedThreadIds] = useState<Set<string>>(
    new Set(),
  );
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
  const cancelMutation = useMutation({
    mutationFn: (threadId: string) =>
      ipc.agent.cancelSubagent({ chatId, threadId }),
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
      if (remediated === "paused") {
        setPendingReviewContinuation(chatId, async () => {
          try {
            await ipc.agent.runAutoReviewBarrier({
              chatId,
              verification: true,
            });
          } catch (error) {
            showError(error);
          } finally {
            await invalidateThreads();
          }
        });
        return;
      }
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
  const sendMessageMutation = useMutation({
    mutationFn: ({
      threadId,
      message,
    }: {
      threadId: string;
      message: string;
    }) => ipc.agent.sendSubagentMessage({ chatId, threadId, message }),
    onSuccess: (_result, { threadId }) => {
      setMessageDrafts((drafts) => ({ ...drafts, [threadId]: "" }));
      void invalidateThreads();
    },
    onError: (error) => showError(error),
  });
  const followupMutation = useMutation({
    mutationFn: async ({
      thread,
      message,
    }: {
      thread: SubagentThreadSummary;
      message: string;
    }) => {
      if (thread.persona === "reviewer") {
        await ipc.agent.followupSubagent({
          chatId,
          threadId: thread.id,
          message,
        });
        return true;
      }
      if (thread.persona !== "explorer") return false;

      return new Promise<boolean>((resolve) => {
        void streamMessage({
          prompt: [
            "Continue an existing Explorer sub-agent by calling followup_task with exactly these arguments:",
            `thread_id: ${JSON.stringify(thread.id)}`,
            `message: ${JSON.stringify(message)}`,
            "Wait for the Explorer to finish, then summarize its result.",
          ].join("\n"),
          chatId,
          requestedChatMode: "local-agent",
          onSettled: ({ success }) => resolve(success),
        });
      });
    },
    onSuccess: (success, { thread }) => {
      if (!success) return;
      const threadId = thread.id;
      setMessageDrafts((drafts) => ({ ...drafts, [threadId]: "" }));
      void invalidateThreads();
    },
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

  const threads = query.data ?? [];
  const transcriptQueries = useQueries({
    queries: threads.map((thread) => ({
      queryKey: queryKeys.subagents.messages({ chatId, threadId: thread.id }),
      queryFn: () =>
        ipc.agent.getSubagentMessages({ chatId, threadId: thread.id }),
      enabled: isPro && expandedThreadIds.has(thread.id),
    })),
  });
  const transcriptQueriesByThreadId = new Map(
    threads.map((thread, index) => [thread.id, transcriptQueries[index]]),
  );
  if (!isPro) return null;
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
  if (rootIsStreaming && visibleThreads.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border bg-muted/20 text-sm">
      <div className="flex items-center justify-between gap-2 p-2">
        <button
          className="flex items-center gap-2 font-medium"
          aria-expanded={expanded}
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
            rootIsStreaming ||
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
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {statusLabel(thread)}
                  </span>
                  {isSubagentCancellable(thread.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Stop ${thread.persona} ${thread.taskName}`}
                      disabled={cancelMutation.isPending}
                      onClick={() => cancelMutation.mutate(thread.id)}
                    >
                      {cancelMutation.isPending &&
                      cancelMutation.variables === thread.id ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Square className="mr-1 h-3.5 w-3.5" />
                      )}
                      Stop
                    </Button>
                  )}
                </div>
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
              <Button
                size="sm"
                variant="ghost"
                className="mt-1"
                aria-label={`${expandedThreadIds.has(thread.id) ? "Hide" : "Show"} details for ${thread.persona} ${thread.taskName}`}
                aria-expanded={expandedThreadIds.has(thread.id)}
                onClick={() =>
                  setExpandedThreadIds((current) => {
                    const next = new Set(current);
                    if (next.has(thread.id)) next.delete(thread.id);
                    else next.add(thread.id);
                    return next;
                  })
                }
              >
                {expandedThreadIds.has(thread.id) ? (
                  <ChevronDown className="mr-1 h-4 w-4" />
                ) : (
                  <ChevronRight className="mr-1 h-4 w-4" />
                )}
                {expandedThreadIds.has(thread.id)
                  ? "Hide details"
                  : "Show details"}
              </Button>
              {expandedThreadIds.has(thread.id) && (
                <div className="mt-2 space-y-2 border-l pl-3">
                  {thread.persona !== "reviewer" &&
                    typeof thread.result?.report === "string" && (
                      <pre
                        aria-label={`${thread.persona} report`}
                        className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs"
                      >
                        {thread.result.report.slice(
                          0,
                          MAX_RENDERED_REPORT_CHARS,
                        )}
                      </pre>
                    )}
                  <div aria-label={`${thread.persona} transcript`}>
                    <p className="text-xs font-medium">Durable transcript</p>
                    {transcriptQueriesByThreadId.get(thread.id)?.isPending ? (
                      <p className="text-xs text-muted-foreground">
                        Loading transcript…
                      </p>
                    ) : transcriptQueriesByThreadId.get(thread.id)?.isError ? (
                      <p className="text-xs text-destructive">
                        Unable to load transcript.
                      </p>
                    ) : transcriptQueriesByThreadId.get(thread.id)?.data
                        ?.length ? (
                      <ol className="mt-1 space-y-1">
                        {transcriptQueriesByThreadId
                          .get(thread.id)
                          ?.data?.map((message) => (
                            <li
                              key={message.id}
                              className="rounded bg-muted/60 p-2 text-xs"
                            >
                              <span className="font-medium capitalize">
                                {message.role}
                              </span>
                              <p className="mt-1 whitespace-pre-wrap">
                                {message.content}
                              </p>
                            </li>
                          ))}
                      </ol>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No durable messages yet.
                      </p>
                    )}
                  </div>
                </div>
              )}
              <div className="mt-2 space-y-2">
                <Textarea
                  aria-label={`Message ${thread.persona} ${thread.taskName}`}
                  value={messageDrafts[thread.id] ?? ""}
                  maxLength={20_000}
                  rows={2}
                  placeholder={`Send a durable message to ${thread.taskName}`}
                  onChange={(event) =>
                    setMessageDrafts((drafts) => ({
                      ...drafts,
                      [thread.id]: event.target.value,
                    }))
                  }
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      !messageDrafts[thread.id]?.trim() ||
                      !isSubagentAcceptingMessages(thread.status) ||
                      sendMessageMutation.isPending ||
                      followupMutation.isPending
                    }
                    title={
                      isSubagentAcceptingMessages(thread.status)
                        ? undefined
                        : "Use Follow up to resume an inactive sub-agent."
                    }
                    onClick={() =>
                      sendMessageMutation.mutate({
                        threadId: thread.id,
                        message: messageDrafts[thread.id].trim(),
                      })
                    }
                  >
                    {sendMessageMutation.isPending &&
                      sendMessageMutation.variables?.threadId === thread.id && (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      )}
                    Send message
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      !messageDrafts[thread.id]?.trim() ||
                      thread.persona === "implementer" ||
                      sendMessageMutation.isPending ||
                      followupMutation.isPending
                    }
                    title={
                      thread.persona === "implementer"
                        ? "Start Implementer follow-ups from a root Agent turn so changes are verified and committed."
                        : undefined
                    }
                    onClick={() =>
                      followupMutation.mutate({
                        thread,
                        message: messageDrafts[thread.id].trim(),
                      })
                    }
                  >
                    {followupMutation.isPending &&
                      followupMutation.variables?.thread.id === thread.id && (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      )}
                    Follow up
                  </Button>
                </div>
              </div>
              {thread.persona === "reviewer" && thread.autoFixAt && (
                <div className="mt-2 flex items-center justify-between rounded bg-amber-500/10 p-2 text-xs">
                  <span aria-live="polite">
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
                      {report.slice(0, MAX_RENDERED_REPORT_CHARS)}
                    </pre>
                    {findingCount > 0 && review.status === "completed" && (
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

function isSubagentCancellable(
  status: SubagentThreadSummary["status"],
): boolean {
  return [
    "queued",
    "running",
    "idle",
    "waiting_for_writer",
    "waiting_for_auto_review",
    "auto_fix_countdown",
    "fixing_findings",
    "verification_review",
    "needs_approval",
  ].includes(status);
}
