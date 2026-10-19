import {
  Check,
  CircleAlert,
  GitBranch,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { showError } from "@/lib/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useChatWorkspaceStatus,
  useRetryWorkspaceIntegration,
} from "@/hooks/useChatWorkspace";
import { useSettings } from "@/hooks/useSettings";
import {
  integrationStatusKey,
  integrationTone,
  shouldShowWorkspaceIndicator,
} from "./workspace_status";

const TONE_CLASSES = {
  neutral: "text-muted-foreground",
  progress: "text-sky-700 dark:text-sky-300",
  success: "text-emerald-700 dark:text-emerald-300",
  attention: "text-amber-700 dark:text-amber-300",
} as const;

interface WorkspaceStatusProps {
  appId: number | null;
  chatId: number | undefined;
}

function useVisibleWorkspaceStatus({ appId, chatId }: WorkspaceStatusProps) {
  const { data: status } = useChatWorkspaceStatus(appId, chatId);
  const { settings } = useSettings();
  return shouldShowWorkspaceIndicator(
    status,
    !!settings?.enableWorktreeIsolation,
  )
    ? status
    : undefined;
}

/** Compact workspace context for the composer toolbar. */
export function WorkspaceStatusIndicator(props: WorkspaceStatusProps) {
  const { t } = useTranslation("chat");
  const tooltipId = useId();
  const status = useVisibleWorkspaceStatus(props);
  if (!status) return null;

  const target = status.targetBranch ?? status.branch ?? "main";
  const branchLabel = status.branch ?? t("workspace.detachedBranch");
  const isMerged = status.integration?.phase === "merged";

  return (
    <Tooltip>
      <TooltipTrigger
        aria-describedby={tooltipId}
        render={
          <span
            tabIndex={0}
            className="inline-flex h-6 min-w-0 max-w-36 items-center gap-1.5 rounded-md bg-muted px-2 text-xs text-foreground/80 cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="chat-workspace-indicator"
          />
        }
      >
        <GitBranch size={12} className="shrink-0" aria-hidden />
        <span className="truncate" data-testid="workspace-branch">
          {branchLabel}
        </span>
        {status.kind === "isolated" && (
          <span className="sr-only"> · {t("workspace.isolated")}</span>
        )}
        {isMerged && (
          <>
            <Check
              size={12}
              className={cn("shrink-0", TONE_CLASSES.success)}
              aria-hidden
            />
            <span className="sr-only">
              {" "}
              · {t("workspace.statusMerged", { target })}
            </span>
          </>
        )}
      </TooltipTrigger>
      <TooltipContent
        id={tooltipId}
        role="tooltip"
        className="max-w-xs space-y-1 wrap-anywhere"
      >
        <p className="font-medium">{branchLabel}</p>
        {status.kind === "isolated" && <p>{t("workspace.isolated")}</p>}
        <p>
          {status.kind === "isolated"
            ? t("workspace.isolatedTooltip", { target })
            : t("workspace.originalTooltip", { branch: branchLabel })}
        </p>
        {isMerged && <p>{t("workspace.statusMerged", { target })}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

/** Only ongoing or blocked merges need a separate row beneath the toolbar. */
export function WorkspaceIntegrationStatus({
  appId,
  chatId,
}: WorkspaceStatusProps) {
  const { t } = useTranslation("chat");
  const tooltipId = useId();
  const status = useVisibleWorkspaceStatus({ appId, chatId });
  const retry = useRetryWorkspaceIntegration(appId);
  if (!status) return null;

  const integration = status.integration;
  const statusKey = integration
    ? integrationStatusKey(integration.phase)
    : null;
  if (!statusKey || integration?.phase === "merged") return null;

  const target = status.targetBranch ?? status.branch ?? "main";
  const tone = integration ? integrationTone(integration.phase) : "neutral";
  const failedChecks =
    integration?.validation?.filter((check) => check.outcome !== "passed") ??
    [];

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-2 pt-0.5 text-xs text-muted-foreground"
      data-testid="workspace-integration-row"
    >
      <Tooltip>
        <TooltipTrigger
          aria-describedby={tooltipId}
          render={
            <span
              tabIndex={0}
              className={cn(
                "inline-flex min-w-0 items-center gap-1.5 rounded-sm cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring",
                TONE_CLASSES[tone],
              )}
              data-testid="workspace-integration-status"
            />
          }
        >
          {tone === "progress" ? (
            <Loader2
              size={12}
              className="animate-spin motion-reduce:animate-none shrink-0"
              aria-hidden
            />
          ) : (
            <CircleAlert size={12} className="shrink-0" aria-hidden />
          )}
          <span className="wrap-anywhere" role="status">
            {t(`workspace.${statusKey}`, { target })}
          </span>
        </TooltipTrigger>
        <TooltipContent
          id={tooltipId}
          role="tooltip"
          className="max-w-sm wrap-anywhere"
        >
          <div className="space-y-1">
            {integration?.detail && <p>{integration.detail}</p>}
            {failedChecks.length > 0 && (
              <ul className="list-disc pl-4">
                {failedChecks.map((check) => (
                  <li key={check.name}>
                    {check.name}: {check.summary}
                  </li>
                ))}
              </ul>
            )}
            {!integration?.detail && failedChecks.length === 0 && (
              <p>{t(`workspace.${statusKey}Tooltip`, { target })}</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>

      {integration?.canRetry && chatId !== undefined && (
        <button
          type="button"
          className="inline-flex min-h-6 shrink-0 items-center gap-1 rounded px-1 text-xs underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          disabled={retry.isPending}
          onClick={() => {
            retry.mutate(chatId, {
              onError: () => showError(t("workspace.retryFailed")),
            });
          }}
          data-testid="workspace-retry-merge"
        >
          <RotateCcw size={11} aria-hidden />
          {t("workspace.retryMerge")}
        </button>
      )}
    </div>
  );
}
