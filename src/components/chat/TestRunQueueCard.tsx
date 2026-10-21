import { skipToken, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Circle,
  FlaskConical,
  Loader2,
  XCircle,
} from "lucide-react";
import { dismissedTestRunThroughIdByAppIdAtom } from "@/atoms/testRuntimeAtoms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSelectChat } from "@/hooks/useSelectChat";
import { useTestRunQueue } from "@/hooks/useTestRunQueue";
import { queryKeys } from "@/lib/queryKeys";
import type { CompletedTestRun } from "@/lib/testRunSummary";
import type { TestRunRequest } from "@/test_run_queue/state";
import { cn } from "@/lib/utils";

/** How long a batch's final outcomes stay readable/announced after it drains. */
export const DRAINED_BATCH_LINGER_MS = 5_000;

type RunStatus = CompletedTestRun["status"] | "queued" | "running" | "stopping";
type QueueRow = TestRunRequest & { status: RunStatus };

const statusClasses: Record<RunStatus, string> = {
  queued: "text-yellow-700 dark:text-yellow-400",
  running: "text-gray-500 dark:text-gray-400",
  stopping: "text-gray-500 dark:text-gray-400",
  passed: "text-green-600 dark:text-green-400",
  failed: "text-red-600 dark:text-red-400",
  inconclusive: "text-yellow-700 dark:text-yellow-400",
};

function RunIcon({ status }: { status: RunStatus }) {
  const Icon =
    status === "running" || status === "stopping"
      ? Loader2
      : status === "passed"
        ? CheckCircle2
        : status === "failed"
          ? XCircle
          : Circle;
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "size-3.5 shrink-0",
        (status === "running" || status === "stopping") && "animate-spin",
        status === "queued" && "size-2 fill-current mx-0.75",
      )}
    />
  );
}

export function TestRunQueueCard({
  appId,
  chatId,
  onOpenTests,
}: {
  appId: number | null;
  chatId?: number;
  onOpenTests: () => void;
}) {
  const { t } = useTranslation("chat");
  const { selectChat } = useSelectChat();
  const [dismissedRunIds, setDismissedRunIds] = useAtom(
    dismissedTestRunThroughIdByAppIdAtom,
  );
  const dismissedThroughId =
    appId === null ? 0 : (dismissedRunIds.get(appId) ?? 0);
  const { data: queue, isFetchedAfterMount } = useTestRunQueue(appId);
  // The permanent lifecycle subscriber fills this bounded event read model.
  const { data: completed = [] } = useQuery<CompletedTestRun[]>({
    queryKey: queryKeys.tests.recentRuns({ appId }),
    queryFn: skipToken,
  });
  // Keep completed rows while the queue advances; dismiss the whole batch only
  // after its last run releases the queue slot, including stopping/cleanup.
  const queueIsIdle =
    queue?.activeRun === null && queue.queuedRuns.length === 0;
  // A batch seen running here lingers after draining so its last outcome is
  // readable; one that finished while chat was closed is dismissed on sight.
  const [watchedBatch, setWatchedBatch] = useState(false);
  if (isFetchedAfterMount && queue && !queueIsIdle && !watchedBatch) {
    setWatchedBatch(true);
  }
  const latestCompletedRunId = completed.reduce(
    (latest, run) => Math.max(latest, run.runId),
    0,
  );
  useEffect(() => {
    if (
      appId === null ||
      !isFetchedAfterMount ||
      !queueIsIdle ||
      latestCompletedRunId <= dismissedThroughId
    )
      return;
    const dismiss = () => {
      setWatchedBatch(false);
      setDismissedRunIds((previous) =>
        new Map(previous).set(
          appId,
          Math.max(previous.get(appId) ?? 0, latestCompletedRunId),
        ),
      );
    };
    if (!watchedBatch) {
      dismiss();
      return;
    }
    // A run queued during the linger keeps the batch open and cancels this.
    const timer = setTimeout(dismiss, DRAINED_BATCH_LINGER_MS);
    return () => clearTimeout(timer);
  }, [
    appId,
    isFetchedAfterMount,
    queueIsIdle,
    watchedBatch,
    latestCompletedRunId,
    dismissedThroughId,
    setDismissedRunIds,
  ]);
  const completedIds = new Set(completed.map((run) => run.runId));
  const rows: QueueRow[] = [
    ...(queue?.activeRun && !completedIds.has(queue.activeRun.runId)
      ? [
          {
            ...queue.activeRun,
            status: queue.activeRun.stopping
              ? ("stopping" as const)
              : ("running" as const),
          },
        ]
      : []),
    ...(queue?.queuedRuns ?? [])
      .filter((run) => !completedIds.has(run.runId))
      .map((run) => ({ ...run, status: "queued" as const })),
    ...completed.filter((run) => run.runId > dismissedThroughId),
  ];
  // Run IDs follow submission order; status changes must not move rows.
  rows.sort((a, b) => a.runId - b.runId);
  if (
    appId === null ||
    !queue ||
    (queueIsIdle && !watchedBatch) ||
    rows.length === 0
  )
    return null;

  function runLabel(run: TestRunRequest): string {
    const files = run.testFiles ?? (run.testFile ? [run.testFile] : []);
    let label = files.length ? files.join(", ") : t("testRunQueue.allTests");
    if (run.testLine != null) label += `:${run.testLine}`;
    if (run.grep) label += ` · ${run.grep}`;
    return label;
  }

  return (
    <section
      aria-label={t("testRunQueue.title")}
      className="mx-2 mb-2 shrink-0 overflow-hidden rounded-xl border border-border bg-(--background-lighter)"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
          <FlaskConical
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          {t("testRunQueue.title")}
        </div>
        <button
          type="button"
          onClick={onOpenTests}
          className="shrink-0 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
        >
          {t("testRunQueue.openTests")}
        </button>
      </div>
      <ul
        aria-live="polite"
        aria-relevant="additions text"
        className="max-h-40 space-y-1 overflow-y-auto scrollbar-on-hover border-t border-border/60 px-3 py-2"
      >
        {rows.map((run) => {
          const label = runLabel(run);
          const runChatId = run.chatId;
          return (
            <li
              key={run.runId}
              className={cn(
                "flex items-center gap-2 text-xs",
                statusClasses[run.status],
              )}
            >
              <RunIcon status={run.status} />
              <span className="min-w-0 flex-1 truncate" title={label}>
                {label}
              </span>
              <span className="shrink-0">
                {t(`testRunQueue.${run.status}`)}
              </span>
              {runChatId != null ? (
                runChatId === chatId ? (
                  <Badge
                    variant="secondary"
                    className="shrink-0 whitespace-nowrap rounded-full px-2 font-normal"
                  >
                    {t("testRunQueue.currentChat")}
                  </Badge>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs text-foreground"
                    onClick={() => selectChat({ appId, chatId: runChatId })}
                  >
                    {t("testRunQueue.openChat")}
                  </Button>
                )
              ) : run.source === "panel" ? (
                <Badge
                  variant="secondary"
                  className="shrink-0 whitespace-nowrap rounded-full px-2 font-normal"
                >
                  {t("testRunQueue.testsPanel")}
                </Badge>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
