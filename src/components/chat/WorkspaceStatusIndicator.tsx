import {
  Check,
  CircleAlert,
  GitBranch,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { showError, showSuccess } from "@/lib/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import type { ChatWorkspaceStatus } from "@/ipc/types";
import {
  useChatWorkspaceStatus,
  useDeleteChatWorkspace,
  useRetryWorkspaceIntegration,
} from "@/hooks/useChatWorkspace";
import { useSettings } from "@/hooks/useSettings";
import {
  canDeleteChatWorkspace,
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
    <div className="flex min-w-0 items-center gap-0.5">
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
      {status.kind === "isolated" && props.chatId !== undefined && (
        <DeleteWorktreeButton
          appId={props.appId}
          chatId={props.chatId}
          status={status}
        />
      )}
    </div>
  );
}

/**
 * Deletes the chat's worktree after confirmation, whether or not its work is
 * merged. Worktrees are never removed automatically, so this is how a user
 * frees the disk space a chat's folder and dependencies take.
 */
function DeleteWorktreeButton({
  appId,
  chatId,
  status,
}: {
  appId: number | null;
  chatId: number;
  status: ChatWorkspaceStatus;
}) {
  const { t } = useTranslation("chat");
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const deleteWorkspace = useDeleteChatWorkspace(appId);
  const available =
    canDeleteChatWorkspace(status) && !deleteWorkspace.isPending;
  const target = status.targetBranch ?? "main";
  const branch = status.branch ?? target;
  // Not the phase: it stays "merged" after a stopped turn leaves edits.
  const merged = !status.hasUnmergedWork;

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              // Stays focusable while busy so the tooltip can say why.
              aria-disabled={!available}
              aria-label={t("workspace.deleteWorktree")}
              className={cn(
                "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                !available &&
                  "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground",
              )}
              onClick={() => {
                if (available) setOpen(true);
              }}
              data-testid="workspace-delete-worktree"
            />
          }
        >
          <Trash2 size={12} aria-hidden />
        </TooltipTrigger>
        <TooltipContent>
          {available
            ? t("workspace.deleteWorktree")
            : t("workspace.deleteWorktreeBusy")}
        </TooltipContent>
      </Tooltip>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent data-testid="delete-worktree-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("workspace.deleteWorktreeTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                {merged
                  ? t("workspace.deleteWorktreeMerged", { target })
                  : t("workspace.deleteWorktreeUnmerged", { target, branch })}
              </span>
              {/* Where the next message works depends on the setting, so say
                  nothing about it until settings load. */}
              {settings && (
                <span className="block">
                  {settings.enableWorktreeIsolation
                    ? t("workspace.deleteWorktreeNextIsolated", { target })
                    : t("workspace.deleteWorktreeNextShared")}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("workspace.deleteWorktreeCancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                deleteWorkspace.mutate(chatId, {
                  onSuccess: () =>
                    showSuccess(t("workspace.deleteWorktreeDone")),
                  onError: (error) =>
                    showError(
                      error instanceof Error && error.message
                        ? error.message
                        : t("workspace.deleteWorktreeFailed"),
                    ),
                });
              }}
              data-testid="workspace-delete-worktree-confirm"
            >
              {t("workspace.deleteWorktree")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
