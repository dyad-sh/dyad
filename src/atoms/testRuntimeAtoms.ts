import { atom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import type { TestSpec, TestResult, TestIsolation } from "@/ipc/types";

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

export const clearTestRuntimeForAppAtom = atom(
  null,
  (_get, set, appId: number) => {
    set(testSpecsByAppIdAtom, (prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
    set(testRunStateByAppIdAtom, (prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
    set(testRunOutputByAppIdAtom, (prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
  },
);
