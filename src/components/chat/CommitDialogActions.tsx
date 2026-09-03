import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  CommitButtonLabel,
  CommitStatusAnnouncement,
} from "./CommitButtonLabel";
import { CommitCheckFailureAlert } from "./CommitCheckFailureAlert";
import type { CommitProgressPhase } from "@/ipc/types/github";
import type { FixPreCommitUnavailableReason } from "@/hooks/useFixPreCommitWithAI";

export function CommitRecoveryAlerts({
  preCommitError,
  prepareCommitMsgError,
  commitMsgError,
  commitError,
  isStartingAiFix,
  isCheckingAiFixAvailability,
  aiFixUnavailableReason,
  onFixPreCommitWithAI,
}: {
  preCommitError: Error | null;
  prepareCommitMsgError: Error | null;
  commitMsgError: Error | null;
  commitError: Error | null;
  isStartingAiFix: boolean;
  isCheckingAiFixAvailability: boolean;
  aiFixUnavailableReason: FixPreCommitUnavailableReason | null;
  onFixPreCommitWithAI: () => void;
}) {
  const { t } = useTranslation("home");

  return (
    <>
      {preCommitError && (
        <CommitCheckFailureAlert
          kind="pre-commit"
          error={preCommitError}
          isStartingFix={isStartingAiFix}
          isCheckingFixAvailability={isCheckingAiFixAvailability}
          fixUnavailableReason={aiFixUnavailableReason}
          onFix={onFixPreCommitWithAI}
        />
      )}

      {commitMsgError && (
        <CommitCheckFailureAlert kind="commit-msg" error={commitMsgError} />
      )}

      {prepareCommitMsgError && (
        <CommitCheckFailureAlert
          kind="prepare-commit-msg"
          error={prepareCommitMsgError}
        />
      )}

      {commitError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3"
          data-testid="commit-failure-alert"
        >
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {t("preview.commitFailed")}
              </p>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 font-mono text-xs text-muted-foreground">
                {commitError.message}
              </pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function CommitDialogFooter({
  leadingAction,
  isCommitting,
  isCancellingCommit,
  phase,
  isBusy,
  commitDisabled,
  commitButtonTestId,
  onDismiss,
  onCancelCommit,
  onCommit,
}: {
  leadingAction?: ReactNode;
  isCommitting: boolean;
  isCancellingCommit: boolean;
  phase: CommitProgressPhase | null;
  isBusy: boolean;
  commitDisabled: boolean;
  commitButtonTestId: string;
  onDismiss: () => void;
  onCancelCommit: () => void;
  onCommit: () => void;
}) {
  const { t } = useTranslation("home");
  const isRunningChecks = phase === "pre-commit" || phase === "commit-msg";
  const canCancelCommit = isCommitting && phase !== "committing";
  const cancelLabel = isCancellingCommit
    ? t("preview.cancellingCommit")
    : isRunningChecks
      ? t("preview.stopChecks")
      : isCommitting
        ? t("preview.cancelCommit")
        : t("preview.cancel");

  return (
    <>
      <CommitStatusAnnouncement isCommitting={isCommitting} phase={phase} />
      {leadingAction}
      <Button
        variant="outline"
        onClick={canCancelCommit ? onCancelCommit : onDismiss}
        disabled={
          isBusy || isCancellingCommit || (isCommitting && !canCancelCommit)
        }
        data-testid="cancel-commit-button"
      >
        {cancelLabel}
      </Button>
      <Button
        onClick={onCommit}
        disabled={commitDisabled || isCommitting || isBusy}
        data-testid={commitButtonTestId}
      >
        <CommitButtonLabel isCommitting={isCommitting} phase={phase} />
      </Button>
    </>
  );
}
