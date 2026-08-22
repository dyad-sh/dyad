import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import type { CommitProgressPhase } from "@/ipc/types/github";

export function CommitButtonLabel({
  isCommitting,
  phase,
}: {
  isCommitting: boolean;
  phase: CommitProgressPhase | null;
}) {
  const { t } = useTranslation("home");

  if (!isCommitting) return t("preview.commit");

  const label = getCommitProgressLabel(t, phase);

  return (
    <>
      <LoaderCircle
        aria-hidden="true"
        className="h-4 w-4 animate-spin motion-reduce:animate-none"
      />
      <span>{label}</span>
    </>
  );
}

export function CommitStatusAnnouncement({
  isCommitting,
  phase,
}: {
  isCommitting: boolean;
  phase: CommitProgressPhase | null;
}) {
  const { t } = useTranslation("home");
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {isCommitting ? getCommitProgressLabel(t, phase) : ""}
    </span>
  );
}

function getCommitProgressLabel(
  t: TFunction<"home">,
  phase: CommitProgressPhase | null,
) {
  return phase === "staging"
    ? t("preview.preparingChanges")
    : phase === "pre-commit"
      ? t("preview.runningPreCommitChecks")
      : phase === "commit-msg"
        ? t("preview.validatingCommitMessage")
        : phase === "committing"
          ? t("preview.creatingCommit")
          : t("preview.committing");
}
