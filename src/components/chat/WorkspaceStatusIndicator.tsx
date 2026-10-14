import { GitBranch, Loader2, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
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

/**
 * Shows where the chat's turns run (branch, and whether it is an isolated
 * workspace) and how its isolated work is being merged, at the bottom of the
 * chat input.
 */
export function WorkspaceStatusIndicator({
  appId,
  chatId,
}: {
  appId: number | null;
  chatId: number | undefined;
}) {
  const { t } = useTranslation("chat");
  const { data: status } = useChatWorkspaceStatus(appId, chatId);
  const { settings } = useSettings();
  const retry = useRetryWorkspaceIntegration(appId);

  if (
    !status ||
    !shouldShowWorkspaceIndicator(status, !!settings?.enableWorktreeIsolation)
  ) {
    return null;
  }

  const target = status.targetBranch ?? status.branch ?? "main";
  const branchLabel = status.branch ?? t("workspace.detachedBranch");
  const integration = status.integration;
  const statusKey = integration
    ? integrationStatusKey(integration.phase)
    : null;
  const tone = integration ? integrationTone(integration.phase) : "neutral";
  const failedChecks =
    integration?.validation?.filter((check) => check.outcome !== "passed") ??
    [];

  return (
    <div
      className="px-3 pb-1 flex items-center gap-1.5 text-xs text-muted-foreground min-w-0"
      data-testid="chat-workspace-indicator"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex items-center gap-1 min-w-0 cursor-default" />
          }
        >
          <GitBranch size={12} className="shrink-0" aria-hidden />
          <span
            className="truncate max-w-[180px]"
            data-testid="workspace-branch"
          >
            {branchLabel}
          </span>
          {status.kind === "isolated" && (
            <span className="shrink-0" data-testid="workspace-isolated-label">
              · {t("workspace.isolated")}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {status.kind === "isolated"
            ? t("workspace.isolatedTooltip", { target })
            : t("workspace.originalTooltip", { branch: branchLabel })}
        </TooltipContent>
      </Tooltip>

      {statusKey && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className={cn(
                  "inline-flex items-center gap-1 min-w-0 cursor-default",
                  TONE_CLASSES[tone],
                )}
                data-testid="workspace-integration-status"
              />
            }
          >
            <span aria-hidden>·</span>
            {tone === "progress" && (
              <Loader2
                size={11}
                className="animate-spin shrink-0"
                aria-hidden
              />
            )}
            <span className="truncate">
              {t(`workspace.${statusKey}`, { target })}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm">
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
      )}

      {integration?.canRetry && chatId !== undefined && (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1 text-xs underline-offset-2 hover:underline disabled:opacity-60"
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
