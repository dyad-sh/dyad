import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  CommitButtonLabel,
  CommitStatusAnnouncement,
} from "./CommitButtonLabel";
import { CommitCheckFailureAlert } from "./CommitCheckFailureAlert";
import type { CommitProgressPhase } from "@/ipc/types/github";

export function CommitRecoveryAlerts({
  preCommitError,
  commitMsgError,
  isStartingAiFix,
  canFixPreCommitWithAI,
  onFixPreCommitWithAI,
}: {
  preCommitError: Error | null;
  commitMsgError: Error | null;
  isStartingAiFix: boolean;
  canFixPreCommitWithAI: boolean;
  onFixPreCommitWithAI: () => void;
}) {
  return (
    <>
      {preCommitError && (
        <CommitCheckFailureAlert
          kind="pre-commit"
          error={preCommitError}
          isStartingFix={isStartingAiFix}
          onFix={canFixPreCommitWithAI ? onFixPreCommitWithAI : undefined}
        />
      )}

      {commitMsgError && (
        <CommitCheckFailureAlert kind="commit-msg" error={commitMsgError} />
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
