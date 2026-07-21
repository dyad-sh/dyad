import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  applyTestRunFinishedAtom,
  applyTestRunStartedAtom,
  clearTestRuntimeForAppAtom,
  currentTestRunStateAtom,
  currentTestSpecsAtom,
  setTestRunStateForAppAtom,
  setTestSpecsForAppAtom,
  testRunOutputByAppIdAtom,
  testRunStateByAppIdAtom,
  testSpecsByAppIdAtom,
} from "@/atoms/testRuntimeAtoms";

describe("test runtime atoms", () => {
  it("clears specs and run state for one app", () => {
    const store = createStore();
    store.set(selectedAppIdAtom, 1);
    store.set(setTestSpecsForAppAtom, {
      appId: 1,
      specs: [{ file: "tests/a.spec.ts", tests: [] }],
    });
    store.set(setTestRunStateForAppAtom, {
      appId: 1,
      update: {
        phase: "running",
        results: {},
        runningFiles: ["tests/a.spec.ts"],
      },
    });

    expect(store.get(currentTestSpecsAtom)).toHaveLength(1);
    expect(store.get(currentTestRunStateAtom).phase).toBe("running");

    store.set(clearTestRuntimeForAppAtom, 1);

    expect(store.get(testSpecsByAppIdAtom).has(1)).toBe(false);
    expect(store.get(testRunStateByAppIdAtom).has(1)).toBe(false);
    expect(store.get(currentTestSpecsAtom)).toEqual([]);
    expect(store.get(currentTestRunStateAtom).phase).toBe("idle");
  });

  it("applyTestRunStartedAtom marks the app setting up and clears its output", () => {
    const store = createStore();
    store.set(setTestSpecsForAppAtom, {
      appId: 1,
      specs: [
        { file: "tests/a.spec.ts", tests: [] },
        { file: "tests/b.spec.ts", tests: [] },
      ],
    });
    store.set(testRunOutputByAppIdAtom, new Map([[1, "stale output"]]));

    // Whole-suite run (no file): every spec is running.
    store.set(applyTestRunStartedAtom, { appId: 1 });
    let state = store.get(testRunStateByAppIdAtom).get(1)!;
    expect(state.phase).toBe("setup");
    expect(state.runningFiles).toEqual(["tests/a.spec.ts", "tests/b.spec.ts"]);
    expect(store.get(testRunOutputByAppIdAtom).get(1)).toBeUndefined();

    // Single-test run: only that test spins; other files' results survive.
    store.set(setTestRunStateForAppAtom, {
      appId: 1,
      update: (prev) => ({
        ...prev,
        phase: "idle",
        results: {
          "tests/b.spec.ts": { file: "tests/b.spec.ts", status: "passed" },
        },
      }),
    });
    store.set(applyTestRunStartedAtom, {
      appId: 1,
      testFile: "tests/a.spec.ts",
      testLine: 3,
    });
    state = store.get(testRunStateByAppIdAtom).get(1)!;
    expect(state.runningFiles).toEqual(["tests/a.spec.ts"]);
    expect(state.runningTests).toEqual(["tests/a.spec.ts:3"]);
    expect(state.results["tests/b.spec.ts"]?.status).toBe("passed");
  });

  it("applyTestRunFinishedAtom reconciles report paths onto known spec keys", () => {
    const store = createStore();
    store.set(setTestSpecsForAppAtom, {
      appId: 1,
      specs: [{ file: "tests/a.spec.ts", tests: [] }],
    });
    store.set(applyTestRunStartedAtom, { appId: 1 });

    // Playwright reports the file testDir-relative ("a.spec.ts"); the result
    // must land under the spec list's "tests/a.spec.ts" key.
    store.set(applyTestRunFinishedAtom, {
      appId: 1,
      res: {
        appId: 1,
        results: [{ file: "a.spec.ts", status: "passed" }],
        isolation: { mode: "neon-branch" },
      },
      isPartialRun: false,
    });
    const state = store.get(testRunStateByAppIdAtom).get(1)!;
    expect(state.phase).toBe("idle");
    expect(state.runningFiles).toEqual([]);
    expect(state.results["tests/a.spec.ts"]?.status).toBe("passed");
    expect(state.isolation).toEqual({ mode: "neon-branch" });
  });

  it("applyTestRunFinishedAtom surfaces an infra error as runError", () => {
    const store = createStore();
    store.set(applyTestRunStartedAtom, { appId: 1 });
    store.set(applyTestRunFinishedAtom, {
      appId: 1,
      res: {
        appId: 1,
        results: [],
        infraError: { message: "bootstrap failed" },
      },
      isPartialRun: false,
    });
    const state = store.get(testRunStateByAppIdAtom).get(1)!;
    expect(state.phase).toBe("idle");
    expect(state.runError).toEqual({
      message: "bootstrap failed",
      kind: "infra",
    });
  });

  it("merges grep-targeted run results instead of replacing the whole file", () => {
    const store = createStore();
    store.set(setTestSpecsForAppAtom, {
      appId: 1,
      specs: [
        {
          file: "tests/a.spec.ts",
          tests: [
            { title: "passes", line: 3 },
            { title: "fails", line: 8 },
          ],
        },
      ],
    });
    store.set(setTestRunStateForAppAtom, {
      appId: 1,
      update: {
        phase: "idle",
        runningFiles: [],
        results: {
          "tests/a.spec.ts": {
            file: "tests/a.spec.ts",
            status: "failed",
            tests: [
              { title: "passes", line: 3, status: "passed" },
              { title: "fails", line: 8, status: "failed" },
            ],
          },
        },
      },
    });

    store.set(applyTestRunStartedAtom, {
      appId: 1,
      testFile: "tests/a.spec.ts",
      grep: "fails",
    });
    store.set(applyTestRunFinishedAtom, {
      appId: 1,
      res: {
        appId: 1,
        results: [
          {
            file: "tests/a.spec.ts",
            status: "passed",
            tests: [{ title: "fails", line: 8, status: "passed" }],
          },
        ],
      },
      isPartialRun: true,
    });

    const result = store.get(testRunStateByAppIdAtom).get(1)?.results[
      "tests/a.spec.ts"
    ];
    expect(result?.status).toBe("passed");
    expect(result?.tests).toEqual([
      { title: "passes", line: 3, status: "passed" },
      { title: "fails", line: 8, status: "passed" },
    ]);
  });
});
