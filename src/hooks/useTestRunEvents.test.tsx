import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  testRunStateByAppIdAtom,
  testSpecsByAppIdAtom,
} from "@/atoms/testRuntimeAtoms";
import { useTestRunEvents } from "@/hooks/useTestRunEvents";

const { runStateListeners, listAppTestsMock } = vi.hoisted(() => ({
  runStateListeners: new Set<(payload: unknown) => void>(),
  listAppTestsMock: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    tests: {
      listAppTests: listAppTestsMock,
    },
    events: {
      tests: {
        onRunState: (listener: (payload: unknown) => void) => {
          runStateListeners.add(listener);
          return () => runStateListeners.delete(listener);
        },
      },
    },
  },
}));

function emitRunState(payload: unknown) {
  for (const listener of runStateListeners) {
    listener(payload);
  }
}

function makeWrapper() {
  const store = createStore();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    store,
    Wrapper({ children }: PropsWithChildren) {
      return (
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>{children}</Provider>
        </QueryClientProvider>
      );
    },
  };
}

describe("useTestRunEvents", () => {
  beforeEach(() => {
    runStateListeners.clear();
    listAppTestsMock.mockReset();
    listAppTestsMock.mockResolvedValue({ specs: [] });
  });

  it("ignores panel-initiated lifecycle events", () => {
    const { store, Wrapper } = makeWrapper();
    renderHook(() => useTestRunEvents(), { wrapper: Wrapper });

    act(() => {
      emitRunState({ appId: 1, source: "panel", state: "started" });
    });

    expect(store.get(testRunStateByAppIdAtom).has(1)).toBe(false);
  });

  it("marks the app running on an agent 'started' event", () => {
    const { store, Wrapper } = makeWrapper();
    renderHook(() => useTestRunEvents(), { wrapper: Wrapper });

    act(() => {
      emitRunState({
        appId: 1,
        source: "agent",
        state: "started",
        testFile: "tests/home.spec.ts",
      });
    });

    const state = store.get(testRunStateByAppIdAtom).get(1)!;
    expect(state.phase).toBe("running");
    expect(state.runningFiles).toEqual(["tests/home.spec.ts"]);
  });

  it("refreshes the spec list before reconciling a finished run, so a spec written this turn shows its result", async () => {
    const { store, Wrapper } = makeWrapper();
    renderHook(() => useTestRunEvents(), { wrapper: Wrapper });

    // The spec atom is empty (the spec was written by the agent this same
    // turn); the fresh fetch is what makes "home.spec.ts" reconcile onto the
    // panel's "tests/home.spec.ts" row key.
    listAppTestsMock.mockResolvedValue({
      specs: [{ file: "tests/home.spec.ts", tests: [] }],
    });

    act(() => {
      emitRunState({
        appId: 1,
        source: "agent",
        state: "started",
        testFile: "tests/home.spec.ts",
      });
      emitRunState({
        appId: 1,
        source: "agent",
        state: "finished",
        testFile: "tests/home.spec.ts",
        // Playwright reports paths testDir-relative (no "tests/" prefix).
        results: [{ file: "home.spec.ts", status: "passed" }],
        isolation: { mode: "neon-branch" },
      });
    });

    await waitFor(() => {
      expect(store.get(testRunStateByAppIdAtom).get(1)?.phase).toBe("idle");
    });
    const state = store.get(testRunStateByAppIdAtom).get(1)!;
    expect(state.results["tests/home.spec.ts"]?.status).toBe("passed");
    expect(store.get(testSpecsByAppIdAtom).get(1)).toEqual([
      { file: "tests/home.spec.ts", tests: [] },
    ]);
  });

  it("still finishes the run when the spec-list refresh fails", async () => {
    const { store, Wrapper } = makeWrapper();
    renderHook(() => useTestRunEvents(), { wrapper: Wrapper });
    listAppTestsMock.mockRejectedValue(new Error("app deleted"));

    act(() => {
      emitRunState({
        appId: 1,
        source: "agent",
        state: "started",
        testFile: "tests/home.spec.ts",
      });
      emitRunState({
        appId: 1,
        source: "agent",
        state: "finished",
        testFile: "tests/home.spec.ts",
        results: [{ file: "tests/home.spec.ts", status: "failed" }],
      });
    });

    // A possibly-unreconciled result beats a stranded "running" state.
    await waitFor(() => {
      expect(store.get(testRunStateByAppIdAtom).get(1)?.phase).toBe("idle");
    });
  });

  it("unsubscribes on unmount", () => {
    const { Wrapper } = makeWrapper();
    const { unmount } = renderHook(() => useTestRunEvents(), {
      wrapper: Wrapper,
    });
    expect(runStateListeners.size).toBe(1);
    unmount();
    expect(runStateListeners.size).toBe(0);
  });
});
