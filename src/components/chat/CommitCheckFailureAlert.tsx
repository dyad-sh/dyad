import { Sparkles, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { FixPreCommitUnavailableReason } from "@/hooks/useFixPreCommitWithAI";

/**
 * Copy for each way the AI fix can be unavailable. The button stays on screen
 * and disabled rather than disappearing, so the reason has somewhere to go and
 * the control does not pop in and out while availability is still loading.
 */
const FIX_UNAVAILABLE_KEYS = {
  "tool-permission": "preview.fixWithAiToolDenied",
  "quota-exhausted": "preview.fixWithAiQuotaExhausted",
  unknown: "preview.fixWithAiUnavailable",
} as const satisfies Record<FixPreCommitUnavailableReason, string>;

/**
 * Which commit hook rejected the commit. `pre-commit` failures are about the
 * code, so the agent can attempt a fix; `prepare-commit-msg` failures point to
 * hook setup or environment problems; and `commit-msg` failures are about the
 * message the user just typed, which they can correct in the field above.
 */
export type CommitCheckKind =
  | "pre-commit"
  | "prepare-commit-msg"
  | "commit-msg";

export function CommitCheckFailureAlert({
  kind,
  error,
  isStartingFix,
  isCheckingFixAvailability,
  fixUnavailableReason,
  onFix,
}: {
  kind: CommitCheckKind;
  error: Error;
  isStartingFix?: boolean;
  isCheckingFixAvailability?: boolean;
  fixUnavailableReason?: FixPreCommitUnavailableReason | null;
  onFix?: () => void;
}) {
  const { t } = useTranslation("home");
  const isPreCommit = kind === "pre-commit";
  const isPrepareCommitMsg = kind === "prepare-commit-msg";

  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 p-3"
      data-testid={
        isPreCommit
          ? "pre-commit-failure-alert"
          : isPrepareCommitMsg
            ? "prepare-commit-msg-failure-alert"
            : "commit-msg-failure-alert"
      }
    >
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-sm font-medium text-foreground">
              {isPreCommit
                ? t("preview.preCommitFailed")
                : isPrepareCommitMsg
                  ? t("preview.prepareCommitMsgFailed")
                  : t("preview.commitMsgFailed")}
            </p>
            <p className="text-sm text-muted-foreground">
              {isPreCommit
                ? t("preview.preCommitFailedDescription")
                : isPrepareCommitMsg
                  ? t("preview.prepareCommitMsgFailedDescription")
                  : t("preview.commitMsgFailedDescription")}
            </p>
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">
              {t("preview.viewPreCommitOutput")}
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 font-mono">
              {error.message}
            </pre>
          </details>
          {isPreCommit && onFix && (
            <div className="space-y-1">
              <Button
                type="button"
                size="sm"
                onClick={onFix}
                disabled={
                  isStartingFix ||
                  isCheckingFixAvailability ||
                  Boolean(fixUnavailableReason)
                }
                data-testid="fix-pre-commit-with-ai-button"
              >
                <Sparkles className="h-4 w-4" />
                {isStartingFix
                  ? t("preview.startingAiFix")
                  : t("preview.fixWithAi")}
              </Button>
              <p className="text-xs text-muted-foreground">
                {isCheckingFixAvailability
                  ? t("preview.checkingAiFixAvailability")
                  : fixUnavailableReason
                    ? t(FIX_UNAVAILABLE_KEYS[fixUnavailableReason])
                    : t("preview.fixWithAiDescription")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
