import { atom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import type { TestSpec, TestResult } from "@/ipc/types";

/**
 * Result-state taxonomy for a single test (see plan's "Result-State Model").
 * Extends the on-disk run statuses ("passed" | "failed" | "inconclusive",
 * returned by the handler) with two UI-only states:
 * - "running": currently executing (spinner).
 * - "not-run": never executed this session (gray).
 */
export type TestStatus = TestResult["status"] | "running" | "not-run";

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
  /** Streamed raw output (bootstrap + test runner), newest appended. */
  output: string;
  /** Results keyed by spec file path. */
  results: Record<string, TestResult>;
  /** Spec files in the current in-flight run (drives per-row spinners). */
  runningFiles: string[];
  /** Set when the whole run fails before producing per-test results. */
  runError?: { message: string; kind: "infra" | "unknown" };
  startedAt?: number;
}

export const EMPTY_TEST_RUN_STATE: TestRunState = {
  phase: "idle",
  output: "",
  results: {},
  runningFiles: [],
};

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
      const next = new Map(prev);
      next.set(appId, nextState);
      return next;
    });
  },
);
