import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  clearTestRuntimeForAppAtom,
  currentTestRunStateAtom,
  currentTestSpecsAtom,
  setTestRunStateForAppAtom,
  setTestSpecsForAppAtom,
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
});
