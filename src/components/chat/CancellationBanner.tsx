import { Loader2 } from "lucide-react";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";

import {
  EMPTY_TEST_RUN_STATE,
  testRunStateByAppIdAtom,
} from "@/atoms/testRuntimeAtoms";

/**
 * Pinned above the composer while a stopped turn settles.
 *
 * Stopping is not instant. The agent awaits its in-flight tool, and a
 * `run_tests` call first kills the Playwright process tree and then runs an
 * isolation teardown that accepts no AbortSignal — restoring `.env.local`,
 * restarting the dev server and deleting the temporary Neon branch, whose
 * delete retries with backoff. That wait can pass a minute, and the composer
 * stays locked for all of it.
 *
 * The transcript's inline status card scrolls out of view; this stays fused to
 * the composer the user just clicked Stop in, so the wait is never unexplained.
 */
export function CancellationBanner({ appId }: { appId?: number | null }) {
  const { t } = useTranslation("chat");
  const runStates = useAtomValue(testRunStateByAppIdAtom);
  // The selected preview can differ from the chat whose turn is settling.
  // Explain only work belonging to this chat's app.
  const runState =
    appId == null
      ? EMPTY_TEST_RUN_STATE
      : (runStates.get(appId) ?? EMPTY_TEST_RUN_STATE);

  // Only an agent-started test run can hold the cancelling turn open. A panel
  // run for the same app may be stopping or cleaning up concurrently, but it
  // does not explain why this chat turn is settling.
  const detail =
    runState.source !== "agent"
      ? null
      : runState.phase === "cleaning-up"
        ? runState.isolation?.mode === "neon-branch"
          ? t("cancellationRestoringTestApp")
          : t("cancellationCleaningTestData")
        : runState.phase === "stopping"
          ? t("cancellationEndingTestRun")
          : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto max-w-3xl px-3 py-1.5 rounded-t-2xl border-t border-l border-r border-amber-500/30 bg-amber-500/10 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500"
      data-testid="cancellation-banner"
    >
      <Loader2 className="h-3.5 w-3.5 shrink-0 mt-px animate-spin" />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{t("stoppingGeneration")}</span>
        {detail && <span className="opacity-80">{detail}</span>}
      </span>
    </div>
  );
}
