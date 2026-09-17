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
  it("clears only selected files and merges mixed batch results", () => {
    const store = createStore();
    const files = [
      "e2e-tests/a.spec.ts",
      "e2e-tests/b.spec.ts",
      "e2e-tests/c.spec.ts",
    ];
    store.set(setTestSpecsForAppAtom, {
      appId: 1,
      specs: files.map((file) => ({ file, tests: [] })),
    });
    store.set(setTestRunStateForAppAtom, {
      appId: 1,
      update: (prev) => ({
        ...prev,
        results: Object.fromEntries(
          files.map((file) => [file, { file, status: "passed" as const }]),
        ),
      }),
    });
    store.set(applyTestRunStartedAtom, {
      appId: 1,
      testFiles: files.slice(0, 2),
      source: "agent",
    });
    const running = store.get(testRunStateByAppIdAtom).get(1)!;
    expect(running.runningFiles).toEqual(files.slice(0, 2));
    expect(Object.keys(running.results)).toEqual([files[2]]);
    store.set(applyTestRunFinishedAtom, {
      appId: 1,
      isPartialRun: false,
      res: {
        appId: 1,
        results: [
          { file: files[0], status: "passed" },
          { file: files[1], status: "failed", error: "broken" },
        ],
      },
    });
    const finished = store.get(testRunStateByAppIdAtom).get(1)!;
    expect(finished.runningFiles).toEqual([]);
    expect(finished.results[files[0]].status).toBe("passed");
    expect(finished.results[files[1]].status).toBe("failed");
    expect(finished.results[files[2]].status).toBe("passed");
  });

  it.each([false, true])(
    "preserves unselected cases in a grep batch (whole suite: %s)",
    (wholeSuite) => {
      const store = createStore();
      const files = ["e2e-tests/a.spec.ts", "e2e-tests/b.spec.ts"];
      const tests = [
        { title: "login", line: 3 },
        { title: "logout", line: 8 },
      ];
      store.set(setTestSpecsForAppAtom, {
        appId: 1,
        specs: files.map((file) => ({ file, tests })),
      });
      store.set(setTestRunStateForAppAtom, {
        appId: 1,
        update: (prev) => ({
          ...prev,
          results: Object.fromEntries(
            files.map((file) => [
              file,
              {
                file,
                status: "failed" as const,
                tests: tests.map((test) => ({
                  ...test,
                  status: "failed" as const,
                  error: "old failure",
                })),
              },
            ]),
          ),
        }),
      });
      store.set(applyTestRunStartedAtom, {
        appId: 1,
        ...(wholeSuite ? {} : { testFiles: files }),
        grep: "login",
        source: "agent",
      });
      const running = store.get(testRunStateByAppIdAtom).get(1)!;
      expect(running.runningTests).toEqual(files.map((file) => `${file}:3`));
      expect(Object.keys(running.results)).toEqual(files);
      store.set(applyTestRunFinishedAtom, {
        appId: 1,
        isPartialRun: true,
        res: {
          appId: 1,
          results: files.map((file) => ({
            file,
            status: "passed" as const,
            tests: [{ ...tests[0], status: "passed" as const }],
          })),
        },
      });
      for (const file of files) {
        const result = store.get(testRunStateByAppIdAtom).get(1)!.results[file];
        expect(result.tests?.map((test) => test.status)).toEqual([
          "passed",
          "failed",
        ]);
      }
    },
  );

  it("keeps unknown hierarchical grep matches visible alongside known matches", () => {
    const store = createStore();
    store.set(setTestSpecsForAppAtom, {
      appId: 1,
      specs: [
        {
          file: "e2e-tests/a.spec.ts",
          tests: [{ title: "auth login", line: 3 }],
        },
        { file: "e2e-tests/b.spec.ts", tests: [{ title: "login", line: 5 }] },
      ],
    });
    store.set(applyTestRunStartedAtom, {
      appId: 1,
      grep: "auth",
      source: "agent",
    });
    expect(store.get(testRunStateByAppIdAtom).get(1)?.runningTests).toEqual([
      "e2e-tests/a.spec.ts:3",
      "e2e-tests/b.spec.ts:5",
    ]);
  });

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
    store.set(applyTestRunStartedAtom, { appId: 1, source: "panel" });
    let state = store.get(testRunStateByAppIdAtom).get(1)!;
    expect(state.phase).toBe("setup");
    expect(state.source).toBe("panel");
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
      source: "panel",
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
    store.set(applyTestRunStartedAtom, { appId: 1, source: "panel" });

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
    store.set(applyTestRunStartedAtom, { appId: 1, source: "panel" });
    store.set(applyTestRunFinishedAtom, {
      appId: 1,
      res: {
        appId: 1,
        results: [{ file: "e2e-tests/a.spec.ts", status: "passed" }],
        infraError: { message: "bootstrap failed" },
      },
      isPartialRun: false,
    });
    const state = store.get(testRunStateByAppIdAtom).get(1)!;
    expect(state.phase).toBe("idle");
    expect(state.results).toEqual({});
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
      source: "panel",
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
