import { Loader2 } from "lucide-react";
import { useAtomValue } from "jotai";

import { currentTestRunStateAtom } from "@/atoms/testRuntimeAtoms";

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
export function CancellationBanner() {
  const runState = useAtomValue(currentTestRunStateAtom);

  // Only the test run knows why the stop is slow. Without an active run the
  // banner stays a single line rather than inventing a reason.
  const detail =
    runState.phase === "cleaning-up"
      ? runState.isolation?.mode === "neon-branch"
        ? "Restoring your app's database and preview. This can take a while."
        : "Cleaning up the test data from this run."
      : runState.phase === "stopping"
        ? "Ending the test run."
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
        <span className="font-medium">Stopping…</span>
        {detail && <span className="opacity-80">{detail}</span>}
      </span>
    </div>
  );
}
