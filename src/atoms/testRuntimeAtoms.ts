import { atom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import type { TestSpec, TestResult, TestIsolation } from "@/ipc/types";
import type { RunAppTestsResult } from "@/ipc/types/tests";
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

export type RuntimeTestResult = Omit<TestResult, "status"> & {
  status: TestResult["status"] | "partial";
};

/**
 * Phases the Tests panel can be in for a given app. Mirrors the "Key States"
 * in the plan.
 */
export type TestRunPhase =
  | "idle" // not running
  | "setup" // first-run Playwright bootstrap streaming
  | "running"; // playwright test executing

export interface TestRunState {
  phase: TestRunPhase;
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
  /** Set when the whole run fails before producing per-test results. */
  runError?: { message: string; kind: "infra" | "unknown" };
  /**
   * How the last completed run's database was isolated. Drives the "isolated
   * test data" badge and the Supabase/no-isolation disclosure. Undefined until
   * a run completes.
   */
  isolation?: TestIsolation;
  startedAt?: number;
}

// Frozen (deeply) so the shared default can't be mutated in place and leak
// across apps. Callers must spread into a new object to modify.
export const EMPTY_TEST_RUN_STATE: TestRunState = Object.freeze({
  phase: "idle",
  results: Object.freeze({}),
  runningFiles: Object.freeze([]),
}) as TestRunState;

/** Cap on the accumulated run output kept in the renderer (keeps the tail). */
const MAX_OUTPUT_LENGTH = 500_000;

// Streamed raw run output (bootstrap + test runner) lives in its own per-app
// atom, deliberately OUTSIDE TestRunState: output is by far the chattiest
// field, and keeping it in the state object every panel row subscribes to
// would re-render the whole Tests panel on every appended chunk.
export const testRunOutputByAppIdAtom = atom<Map<number, string>>(new Map());

export const currentTestRunOutputAtom = atom((get) => {
  const appId = get(selectedAppIdAtom);
  return appId === null ? "" : (get(testRunOutputByAppIdAtom).get(appId) ?? "");
});

export const appendTestRunOutputAtom = atom(
  null,
  (_get, set, { appId, chunk }: { appId: number; chunk: string }) => {
    set(testRunOutputByAppIdAtom, (prev) => {
      const next = new Map(prev);
      next.set(
        appId,
        ((prev.get(appId) ?? "") + chunk).slice(-MAX_OUTPUT_LENGTH),
      );
      return next;
    });
  },
);

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

// Per-app maps, mirroring previewRunStateByAppIdAtom.
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
      update,
    }: {
      appId: number;
      update: TestRunState | ((prev: TestRunState) => TestRunState);
    },
  ) => {
    set(testRunStateByAppIdAtom, (prev) => {
      const current = prev.get(appId) ?? EMPTY_TEST_RUN_STATE;
      const nextState = typeof update === "function" ? update(current) : update;
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
 * same spinners/cleared-output state. Global per-app writes only — UI side
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
      testLine,
      grep,
      startedAt,
    }: {
      appId: number;
      testFile?: string;
      testLine?: number;
      grep?: string;
      startedAt?: number;
    },
  ) => {
    const isPartialRun = testFile != null && (testLine != null || !!grep);
    const specs = get(testSpecsByAppIdAtom).get(appId) ?? [];
    const targetFiles = testFile ? [testFile] : specs.map((s) => s.file);
    const grepMatchedTests =
      testFile != null && testLine == null && grep
        ? grepMatchedTestKeys(grep, specs, testFile)
        : null;
    set(clearTestRunOutputForAppAtom, appId);
    set(setTestRunStateForAppAtom, {
      appId,
      update: (prev) => ({
        ...prev,
        // A run starts in setup: isolation prep and the Playwright bootstrap
        // both run before the first test does. Setup-phase output keeps it
        // here; the first running-phase output advances it.
        phase: "setup",
        runningFiles: targetFiles,
        runningTests:
          testFile != null && testLine != null
            ? [testKey(testFile, testLine)]
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
        runError: undefined,
        isolation: undefined,
        startedAt: startedAt ?? Date.now(),
      }),
    });
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
    }: {
      appId: number;
      res: RunAppTestsResult;
      isPartialRun: boolean;
      expectedStartedAt?: number;
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
        if (
          expectedStartedAt !== undefined &&
          prev.startedAt !== expectedStartedAt
        ) {
          return prev;
        }
        const nextResults = { ...prev.results };
        for (const r of res.results) {
          const key = reconcileResultFile(r.file, specFiles);
          const mapped = { ...r, file: key };
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
        }
        return {
          ...prev,
          phase: "idle",
          runningFiles: [],
          runningTests: [],
          results: nextResults,
          runError: res.infraError
            ? { message: res.infraError.message, kind: "infra" }
            : undefined,
          isolation: res.isolation,
        };
      },
    });
  },
);

export const clearTestRuntimeForAppAtom = atom(
  null,
  (_get, set, appId: number) => {
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
