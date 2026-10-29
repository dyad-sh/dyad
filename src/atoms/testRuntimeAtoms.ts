import { atom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  appendTestOutputTabAtom,
  clearTestOutputTabsForAppAtom,
  MAX_TEST_RUN_OUTPUT_LENGTH,
  openTestOutputTabAtom,
  setTestOutputTabErrorAtom,
} from "./testOutputAtoms";
import type {
  TestSpec,
  TestResult,
  TestIsolation,
  TestCaseResult,
} from "@/ipc/types";
import type { RunAppTestsResult } from "@/ipc/types/tests";
import type { TestRunStopReason } from "@/shared/test_run_stop";
import {
  buildSingleTestFileResult,
  reconcileResultFile,
  testKey,
} from "@/lib/testResultUtils";

/**
 * Apps for which the user dismissed the "move legacy tests to e2e-tests/" offer
 * this session. Session-scoped (not persisted): a completed move removes the
 * files from `tests/`, so detection stops returning them and the banner clears
 * on its own — this only suppresses the banner when the user declines.
 */
export const dismissedLegacyTestMigrationAppIdsAtom = atom<Set<number>>(
  new Set<number>(),
);

/** Last completed batch hidden from each app's chat card in this window/session. */
export const dismissedTestRunThroughIdByAppIdAtom = atom<Map<number, number>>(
  new Map(),
);

/**
 * Result-state taxonomy for a single test (see plan's "Result-State Model").
 * Extends the on-disk run statuses ("passed" | "failed" | "inconclusive",
 * returned by the handler) with two UI-only states:
 * - "running": currently executing (spinner).
 * - "not-run": never executed this session (gray).
 */
export type TestStatus =
  | TestResult["status"]
  | "partial"
  | "running"
  | "not-run";

export type RuntimeTestResult = Omit<TestResult, "status" | "tests"> & {
  status: TestResult["status"] | "partial";
  runId?: number;
  tests?: (TestCaseResult & { runId?: number })[];
};

/**
 * Phases the Tests panel can be in for a given app. Mirrors the "Key States"
 * in the plan.
 */
export type TestRunPhase =
  | "idle" // not running
  | "setup" // first-run Playwright bootstrap streaming
  | "running" // playwright test executing
  | "stopping" // Stop pressed; killing the Playwright process tree
  | "cleaning-up"; // tests gone; provider data and/or the run's sandbox copy
// of the app are still being removed

export interface TestRunState {
  phase: TestRunPhase;
  /** Per-run presentation of main's lifecycle events; never schedules runs. */
  activeRuns?: Record<number, TestRunProgress>;
  /** Main-owned per-app generation used to reject stale lifecycle events. */
  runId?: number;
  /** Surface that started the active run. */
  source?: "panel" | "agent";
  /** Whether this run entered cleanup after being stopped by the user/agent. */
  wasStopped?: boolean;
  /** Results keyed by spec file path. */
  results: Record<string, RuntimeTestResult>;
  /** Spec files in the current in-flight run (drives per-file spinners). */
  readonly runningFiles: readonly string[];
  /**
   * Test keys (`file:line`) in the current in-flight run, when a single test is
   * being run. Empty/undefined means the whole file(s) are running, so every
   * test under a running file shows a spinner.
   */
  runningTests?: string[];
  /**
   * Set when the whole run fails before producing per-test results, or was
   * stopped. A stop carries the cause main recorded.
   */
  runError?: {
    message: string;
    kind: "infra" | "stopped" | "unknown";
    stopReason?: TestRunStopReason;
  };
  /**
   * How the last completed run's database was isolated. Drives the "isolated
   * test data" badge and the Supabase/no-isolation disclosure. Undefined until
   * a run completes.
   */
  isolation?: TestIsolation;
  /**
   * Whether the run executed in an isolated sandbox. Drives the cleanup copy:
   * the fallback path (Docker/cloud runtime, or the user's opt-out) creates no
   * workspace, so there is no sandbox to claim Dyad is deleting.
   */
  sandboxed?: boolean;
  startedAt?: number;
}

export type TestRunProgress = Omit<TestRunState, "results" | "activeRuns">;

function runProgress({
  results: _results,
  activeRuns: _runs,
  ...progress
}: TestRunState): TestRunProgress {
  return progress;
}

/** Keep the app's summary active until every independently owned run settles. */
function projectActiveRuns(state: TestRunState): TestRunState {
  const runs = Object.values(state.activeRuns ?? {});
  if (!runs.length) return state;
  // Executing runs take precedence over another run's teardown in the toolbar.
  const executing = runs.filter(
    (run) => run.phase === "setup" || run.phase === "running",
  );
  const current = (executing.length ? executing : runs).reduce((latest, run) =>
    (run.runId ?? 0) > (latest.runId ?? 0) ? run : latest,
  );
  return {
    ...state,
    ...current,
    runError: state.runError,
    isolation: state.isolation,
    runningFiles: [...new Set(runs.flatMap((run) => run.runningFiles))],
  };
}

// Frozen (deeply) so the shared default can't be mutated in place and leak
// across apps. Callers must spread into a new object to modify.
export const EMPTY_TEST_RUN_STATE: TestRunState = Object.freeze({
  phase: "idle",
  results: Object.freeze({}),
  runningFiles: Object.freeze([]),
}) as TestRunState;

// Keep the current batch's output for Ask AI to Fix, independently of which
// output tabs the user has selected or closed. Logs stay outside TestRunState
// so appending chunks does not re-render every test row.
export const testRunOutputByAppIdAtom = atom<Map<number, Map<number, string>>>(
  new Map(),
);

export const currentTestRunOutputAtom = atom((get) => {
  const appId = get(selectedAppIdAtom);
  const runId =
    appId === null ? undefined : get(testRunStateByAppIdAtom).get(appId)?.runId;
  return appId === null || runId === undefined
    ? ""
    : (get(testRunOutputByAppIdAtom).get(appId)?.get(runId) ?? "");
});

export const appendTestRunOutputAtom = atom(
  null,
  (
    _get,
    set,
    { appId, runId, chunk }: { appId: number; runId: number; chunk: string },
  ) => {
    set(appendTestOutputTabAtom, { appId, runId, chunk });
    set(testRunOutputByAppIdAtom, (prev) => {
      const next = new Map(prev);
      const runs = new Map(prev.get(appId));
      runs.set(
        runId,
        ((runs.get(runId) ?? "") + chunk).slice(-MAX_TEST_RUN_OUTPUT_LENGTH),
      );
      next.set(appId, runs);
      return next;
    });
  },
);

// Retain output only while a run is active or a displayed result refers to it.
// Closing an output tab must not discard context for Ask AI to Fix.
const pruneTestRunOutputAtom = atom(null, (get, set, appId: number) => {
  const state = get(testRunStateByAppIdAtom).get(appId);
  const ids = new Set(Object.keys(state?.activeRuns ?? {}).map(Number));
  for (const result of Object.values(state?.results ?? {})) {
    if (result.runId !== undefined) ids.add(result.runId);
    for (const test of result.tests ?? [])
      if (test.runId !== undefined) ids.add(test.runId);
  }
  set(testRunOutputByAppIdAtom, (prev) => {
    const runs = prev.get(appId);
    if (!runs) return prev;
    return new Map(prev).set(
      appId,
      new Map([...runs].filter(([id]) => ids.has(id))),
    );
  });
});

export const clearTestRunOutputForAppAtom = atom(
  null,
  (_get, set, appId: number) => {
    set(testRunOutputByAppIdAtom, (prev) => {
      if (!prev.has(appId)) return prev;
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
  },
);

// Per-app maps keep test discovery and execution state isolated by app.
export const testSpecsByAppIdAtom = atom<Map<number, TestSpec[]>>(new Map());
export const testRunStateByAppIdAtom = atom<Map<number, TestRunState>>(
  new Map(),
);

export const currentTestSpecsAtom = atom((get) => {
  const appId = get(selectedAppIdAtom);
  return appId === null ? [] : (get(testSpecsByAppIdAtom).get(appId) ?? []);
});

export const currentTestRunStateAtom = atom((get) => {
  const appId = get(selectedAppIdAtom);
  return appId === null
    ? EMPTY_TEST_RUN_STATE
    : (get(testRunStateByAppIdAtom).get(appId) ?? EMPTY_TEST_RUN_STATE);
});

export const setTestSpecsForAppAtom = atom(
  null,
  (_get, set, { appId, specs }: { appId: number; specs: TestSpec[] }) => {
    set(testSpecsByAppIdAtom, (prev) => {
      const next = new Map(prev);
      next.set(appId, specs);
      return next;
    });
  },
);

export const setTestRunStateForAppAtom = atom(
  null,
  (
    get,
    set,
    {
      appId,
      runId,
      update,
    }: {
      appId: number;
      /** Scope progress updates to their producer, even while other runs execute. */
      runId?: number;
      update: TestRunState | ((prev: TestRunState) => TestRunState);
    },
  ) => {
    set(testRunStateByAppIdAtom, (prev) => {
      const current = prev.get(appId) ?? EMPTY_TEST_RUN_STATE;
      const progress =
        runId === undefined ? undefined : current.activeRuns?.[runId];
      if (runId !== undefined && !progress) return prev;
      const target = progress ? { ...current, ...progress } : current;
      const updated = typeof update === "function" ? update(target) : update;
      if (updated === target) return prev;
      const nextState = progress
        ? projectActiveRuns({
            ...current,
            activeRuns: {
              ...current.activeRuns,
              [runId!]: runProgress(updated),
            },
          })
        : updated;
      // An updater may return the previous state to signal "no change" (e.g.
      // the streamed-output subscriber when the phase is unchanged) — skip the
      // Map copy so subscribers don't re-render for nothing.
      if (nextState === current) return prev;
      const next = new Map(prev);
      next.set(appId, nextState);
      return next;
    });
  },
);

/**
 * Transition an app into the "running" state for a test run. Shared by
 * panel-initiated runs (TestsPanel.runTests) and agent-initiated runs (the
 * root-level tests:run-state subscriber in useTestRunEvents), so both show the
 * same spinners and per-run output tabs. Global per-app writes only — UI side
 * effects (e.g. popping the output drawer) stay in the panel, keyed off the
 * resulting phase transition.
 */
/**
 * Test keys a `--grep` run will actually execute, so only those show a spinner
 * and the siblings Playwright will skip keep the status they already had.
 *
 * Returns null when the subset can't be determined — an invalid regex, or a
 * pattern that matched nothing here because Playwright greps the FULL
 * hierarchical title (describe blocks included) while the spec list only knows
 * leaf `test()` names. Callers fall back to spinning the whole file, which is
 * the honest answer when we don't know the subset.
 */
function grepMatchedTestKeys(
  grep: string,
  specs: TestSpec[],
  testFile: string,
): string[] | null {
  let regex: RegExp;
  try {
    regex = new RegExp(grep);
  } catch {
    return null;
  }
  const cases = specs.find((s) => s.file === testFile)?.tests ?? [];
  const matched = cases
    .filter((c) => regex.test(c.title))
    .map((c) => testKey(testFile, c.line));
  return matched.length > 0 ? matched : null;
}

export const applyTestRunStartedAtom = atom(
  null,
  (
    get,
    set,
    {
      appId,
      testFile,
      testFiles,
      testLine,
      grep,
      startedAt,
      runId,
      source,
      sandboxed,
    }: {
      appId: number;
      testFile?: string;
      testFiles?: string[];
      testLine?: number;
      grep?: string;
      startedAt?: number;
      runId?: number;
      source: "panel" | "agent";
      /**
       * Whether this run is expected to be sandboxed, read when it started.
       * The main process confirms it later, but the setup phase is over by
       * then and the status line has to describe the wait it is actually in —
       * so a Settings toggle mid-run cannot relabel a run that already chose
       * its path.
       */
      sandboxed?: boolean;
    },
  ) => {
    const isPartialRun = testLine != null || !!grep;
    const specs = get(testSpecsByAppIdAtom).get(appId) ?? [];
    const targetFiles =
      testFiles ?? (testFile ? [testFile] : specs.map((s) => s.file));
    if (runId !== undefined) {
      const files = testFiles ?? (testFile ? [testFile] : []);
      const target =
        files.length === 1
          ? `${files[0].split(/[\\/]/).pop()}${testLine != null ? `:${testLine}` : ""}`
          : undefined;
      set(openTestOutputTabAtom, {
        appId,
        runId,
        target,
        fileCount: files.length,
      });
    }
    const grepMatchedTests =
      testLine == null && grep
        ? targetFiles.flatMap(
            (file) =>
              // Unknown hierarchical matches spin that file's known cases only;
              // matches in another file must not hide this file's activity.
              grepMatchedTestKeys(grep, specs, file) ??
              (specs.find((s) => s.file === file)?.tests ?? []).map((test) =>
                testKey(file, test.line),
              ),
          )
        : null;
    set(setTestRunStateForAppAtom, {
      appId,
      update: (prev) => {
        const started: TestRunState = {
          ...prev,
          activeRuns: runId === undefined ? undefined : prev.activeRuns,
          // A run starts in setup: isolation prep and the Playwright bootstrap
          // both run before the first test does. Setup-phase output keeps it
          // here; the first running-phase output advances it.
          phase: "setup",
          runId,
          source,
          wasStopped: false,
          runningFiles: targetFiles,
          runningTests:
            targetFiles.length === 1 && testLine != null
              ? [testKey(targetFiles[0], testLine)]
              : (grepMatchedTests ?? []),
          // For a single-test run, keep the file's existing results (siblings
          // keep their status; we merge the one test back in afterward). Grep
          // runs are also partial because they return only the matched tests.
          // For a file/all run, clear the targeted files.
          results: isPartialRun
            ? prev.results
            : Object.fromEntries(
                Object.entries(prev.results).filter(
                  ([f]) => !targetFiles.includes(f),
                ),
              ),
          runError: Object.keys(prev.activeRuns ?? {}).length
            ? prev.runError
            : undefined,
          isolation: Object.keys(prev.activeRuns ?? {}).length
            ? prev.isolation
            : undefined,
          // The starter's expectation; the main process confirms (or corrects)
          // it on the progress and finished events. `?? prev` rather than a bare
          // assignment: this atom is applied TWICE for one run — once optimistically
          // at the click, then again when the main process broadcasts `started` —
          // and a caller that omits the flag must not erase what the first call
          // knew.
          sandboxed: sandboxed ?? prev.sandboxed,
          startedAt: startedAt ?? Date.now(),
        };
        return runId === undefined
          ? started
          : projectActiveRuns({
              ...started,
              activeRuns: { ...prev.activeRuns, [runId]: runProgress(started) },
            });
      },
    });
    set(pruneTestRunOutputAtom, appId);
  },
);

/**
 * Merge a finished run's results back onto an app's run state. Shared by
 * panel- and agent-initiated runs (see applyTestRunStartedAtom).
 */
export const applyTestRunFinishedAtom = atom(
  null,
  (
    get,
    set,
    {
      appId,
      res,
      isPartialRun,
      expectedStartedAt,
      expectedRunId,
      sandboxed,
    }: {
      appId: number;
      res: RunAppTestsResult;
      isPartialRun: boolean;
      expectedStartedAt?: number;
      expectedRunId?: number;
      sandboxed?: boolean;
    },
  ) => {
    // Playwright reports a spec's `file` relative to its own rootDir, which
    // may not match the glob-relative paths in our spec list (e.g. missing
    // the "e2e-tests/" prefix). Reconcile each result back onto a known spec
    // key so rows actually pick up their status.
    const appSpecs = get(testSpecsByAppIdAtom).get(appId) ?? [];
    const specFiles = appSpecs.map((s) => s.file);
    const specsByFile = new Map(appSpecs.map((s) => [s.file, s]));
    set(setTestRunStateForAppAtom, {
      appId,
      update: (prev) => {
        const progress =
          expectedRunId === undefined
            ? prev
            : (prev.activeRuns?.[expectedRunId] ?? prev);
        if (
          (expectedRunId !== undefined && progress.runId !== expectedRunId) ||
          (expectedStartedAt !== undefined &&
            progress.startedAt !== expectedStartedAt)
        ) {
          return prev;
        }
        const nextResults = { ...prev.results };
        // Infrastructure/cleanup warnings do not invalidate completed results.
        // Main marks files whose selected cases did not all finish separately.
        for (const r of res.results) {
          const key = reconcileResultFile(r.file, specFiles);
          const mapped = {
            ...r,
            file: key,
            runId: expectedRunId,
            tests: r.tests?.map((test) => ({ ...test, runId: expectedRunId })),
          };
          if (isPartialRun) {
            nextResults[key] = buildSingleTestFileResult({
              file: key,
              knownTests: specsByFile.get(key)?.tests ?? [],
              previous: prev.results[key],
              incoming: mapped,
            });
          } else {
            nextResults[key] = mapped;
          }
          if (r.incomplete) {
            const result = nextResults[key];
            nextResults[key] = {
              ...result,
              incomplete: true,
              status: result.status === "passed" ? "partial" : result.status,
            };
          }
        }
        const activeRuns = { ...prev.activeRuns };
        if (expectedRunId !== undefined) delete activeRuns[expectedRunId];
        return projectActiveRuns({
          ...prev,
          activeRuns: expectedRunId === undefined ? {} : activeRuns,
          phase: "idle",
          wasStopped: false,
          runningFiles: [],
          runningTests: [],
          results: nextResults,
          runError: res.infraError?.stopReason
            ? {
                message: res.infraError.message,
                kind: "stopped",
                stopReason: res.infraError.stopReason,
              }
            : res.infraError
              ? { message: res.infraError.message, kind: "infra" }
              : prev.runError,
          isolation: res.isolation,
          sandboxed: sandboxed ?? prev.sandboxed,
        });
      },
    });
    if (expectedRunId !== undefined)
      set(setTestOutputTabErrorAtom, {
        appId,
        runId: expectedRunId,
        error: res.infraError?.message,
      });
    set(pruneTestRunOutputAtom, appId);
  },
);

export const clearTestRuntimeForAppAtom = atom(
  null,
  (_get, set, appId: number) => {
    set(clearTestOutputTabsForAppAtom, appId);
    set(dismissedTestRunThroughIdByAppIdAtom, (prev) => {
      if (!prev.has(appId)) return prev;
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
    set(testSpecsByAppIdAtom, (prev) => {
      if (!prev.has(appId)) return prev;
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
    set(testRunStateByAppIdAtom, (prev) => {
      if (!prev.has(appId)) return prev;
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
    set(testRunOutputByAppIdAtom, (prev) => {
      if (!prev.has(appId)) return prev;
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
  },
);
