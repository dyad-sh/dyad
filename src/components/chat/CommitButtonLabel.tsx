import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

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

  const label =
    phase === "staging"
      ? t("preview.preparingChanges")
      : phase === "pre-commit"
        ? t("preview.runningPreCommitChecks")
        : phase === "commit-msg"
          ? t("preview.validatingCommitMessage")
          : phase === "committing"
            ? t("preview.creatingCommit")
            : t("preview.committing");

  return (
    <>
      <LoaderCircle
        aria-hidden="true"
        className="h-4 w-4 animate-spin motion-reduce:animate-none"
      />
      <span aria-live="polite">{label}</span>
    </>
  );
}
