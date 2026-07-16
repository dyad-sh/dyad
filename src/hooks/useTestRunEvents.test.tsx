import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  setTestRunStateForAppAtom,
  testRunOutputByAppIdAtom,
  testRunStateByAppIdAtom,
  testSpecsByAppIdAtom,
} from "@/atoms/testRuntimeAtoms";
import { useTestRunEvents } from "@/hooks/useTestRunEvents";
import { queryKeys } from "@/lib/queryKeys";

const { outputListeners, runStateListeners, listAppTestsMock } = vi.hoisted(
  () => ({
    outputListeners: new Set<(payload: unknown) => void>(),
    runStateListeners: new Set<(payload: unknown) => void>(),
    listAppTestsMock: vi.fn(),
  }),
);

vi.mock("@/ipc/types", () => ({
  ipc: {
    tests: {
      listAppTests: listAppTestsMock,
    },
    events: {
      tests: {
        onOutput: (listener: (payload: unknown) => void) => {
          outputListeners.add(listener);
          return () => outputListeners.delete(listener);
        },
        onRunState: (listener: (payload: unknown) => void) => {
          runStateListeners.add(listener);
          return () => runStateListeners.delete(listener);
        },
      },
    },
  },
}));

function emitOutput(payload: unknown) {
  for (const listener of outputListeners) {
    listener(payload);
  }
}

function emitRunState(payload: unknown) {
  for (const listener of runStateListeners) {
    listener(payload);
  }
}

function makeWrapper() {
  const store = createStore();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  return {
    store,
    queryClient,
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
    outputListeners.clear();
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

  it("stores streamed output at root scope", async () => {
    vi.useFakeTimers();
    try {
      const { store, Wrapper } = makeWrapper();
      renderHook(() => useTestRunEvents(), { wrapper: Wrapper });

      act(() => {
        emitRunState({ appId: 1, source: "agent", state: "started" });
        emitOutput({ appId: 1, chunk: "setup\n", phase: "setup" });
        emitOutput({ appId: 1, chunk: "running\n", phase: "running" });
        vi.advanceTimersByTime(100);
      });

      expect(store.get(testRunOutputByAppIdAtom).get(1)).toBe(
        "setup\nrunning\n",
      );
      expect(store.get(testRunStateByAppIdAtom).get(1)?.phase).toBe("running");
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the app setting up on an agent 'started' event", () => {
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
    expect(state.phase).toBe("setup");
    expect(state.runningFiles).toEqual(["tests/home.spec.ts"]);
  });

  it("keeps the setup phase for setup output, then advances on running output", () => {
    vi.useFakeTimers();
    try {
      const { store, Wrapper } = makeWrapper();
      renderHook(() => useTestRunEvents(), { wrapper: Wrapper });

      act(() => {
        emitRunState({ appId: 1, source: "agent", state: "started" });
        emitOutput({ appId: 1, chunk: "installing\n", phase: "setup" });
        vi.advanceTimersByTime(100);
      });
      expect(store.get(testRunStateByAppIdAtom).get(1)?.phase).toBe("setup");

      act(() => {
        emitOutput({ appId: 1, chunk: "Running 1 test\n", phase: "running" });
        vi.advanceTimersByTime(100);
      });
      expect(store.get(testRunStateByAppIdAtom).get(1)?.phase).toBe("running");

      // Teardown streams setup-phase output after the tests ran; the label
      // must not flash back to "Setting up testing…".
      act(() => {
        emitOutput({ appId: 1, chunk: "cleaning up\n", phase: "setup" });
        vi.advanceTimersByTime(100);
      });
      expect(store.get(testRunStateByAppIdAtom).get(1)?.phase).toBe("running");
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes the spec list before reconciling a finished run, so a spec written this turn shows its result", async () => {
    const { store, queryClient, Wrapper } = makeWrapper();
    renderHook(() => useTestRunEvents(), { wrapper: Wrapper });

    // The spec atom is empty (the spec was written by the agent this same
    // turn); the fresh fetch is what makes "home.spec.ts" reconcile onto the
    // panel's "tests/home.spec.ts" row key.
    listAppTestsMock.mockResolvedValue({
      specs: [{ file: "tests/home.spec.ts", tests: [] }],
    });
    // Reproduce the production cache window. The subscriber must still hit IPC
    // instead of reusing this fresh, now-stale list.
    queryClient.setQueryData(queryKeys.tests.list({ appId: 1 }), { specs: [] });

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
      expect(listAppTestsMock).toHaveBeenCalledWith({ appId: 1 });
      expect(
        store.get(testRunStateByAppIdAtom).get(1)?.results["tests/home.spec.ts"]
          ?.status,
      ).toBe("passed");
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

  it("finishes immediately and does not let an older refresh finish a newer run", async () => {
    const { store, Wrapper } = makeWrapper();
    renderHook(() => useTestRunEvents(), { wrapper: Wrapper });
    let resolveRefresh!: (value: { specs: [] }) => void;
    listAppTestsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    act(() => {
      emitRunState({
        appId: 1,
        source: "agent",
        state: "started",
        testFile: "tests/old.spec.ts",
      });
      emitRunState({
        appId: 1,
        source: "agent",
        state: "finished",
        testFile: "tests/old.spec.ts",
        results: [{ file: "tests/old.spec.ts", status: "passed" }],
      });
    });

    expect(store.get(testRunStateByAppIdAtom).get(1)?.phase).toBe("idle");

    await act(async () => {
      emitRunState({
        appId: 1,
        source: "agent",
        state: "started",
        testFile: "tests/new.spec.ts",
      });
      resolveRefresh({ specs: [] });
      await Promise.resolve();
    });

    const state = store.get(testRunStateByAppIdAtom).get(1)!;
    expect(state.phase).toBe("setup");
    expect(state.runningFiles).toEqual(["tests/new.spec.ts"]);
  });

  it("does not let an older agent refresh finish a newer panel run", async () => {
    const { store, Wrapper } = makeWrapper();
    renderHook(() => useTestRunEvents(), { wrapper: Wrapper });
    let resolveRefresh!: (value: { specs: [] }) => void;
    listAppTestsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    act(() => {
      emitRunState({
        appId: 1,
        source: "agent",
        state: "started",
        testFile: "tests/old.spec.ts",
      });
      emitRunState({
        appId: 1,
        source: "agent",
        state: "finished",
        testFile: "tests/old.spec.ts",
        results: [{ file: "tests/old.spec.ts", status: "passed" }],
      });
      emitRunState({
        appId: 1,
        source: "panel",
        state: "started",
        testFile: "tests/new.spec.ts",
      });
      store.set(setTestRunStateForAppAtom, {
        appId: 1,
        update: {
          phase: "running",
          runningFiles: ["tests/new.spec.ts"],
          runningTests: [],
          results: {},
        },
      });
    });

    await act(async () => {
      resolveRefresh({ specs: [] });
      await Promise.resolve();
    });

    const state = store.get(testRunStateByAppIdAtom).get(1)!;
    expect(state.phase).toBe("running");
    expect(state.runningFiles).toEqual(["tests/new.spec.ts"]);
    expect(state.results["tests/old.spec.ts"]).toBeUndefined();
  });

  it("unsubscribes on unmount", () => {
    const { Wrapper } = makeWrapper();
    const { unmount } = renderHook(() => useTestRunEvents(), {
      wrapper: Wrapper,
    });
    expect(outputListeners.size).toBe(1);
    expect(runStateListeners.size).toBe(1);
    unmount();
    expect(outputListeners.size).toBe(0);
    expect(runStateListeners.size).toBe(0);
  });
});
