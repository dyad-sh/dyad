import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { TestRunQueueSnapshot } from "@/ipc/types/tests";
import { useTestRunQueue } from "./useTestRunQueue";
type QueueStateEvent = TestRunQueueSnapshot & { appId: number };

const mocks = vi.hoisted(() => ({
  getRunQueue: vi.fn(),
  listeners: new Set<(value: QueueStateEvent) => void>(),
}));
vi.mock("@/ipc/types", () => ({
  ipc: {
    tests: { getRunQueue: mocks.getRunQueue },
    events: {
      tests: {
        onQueueState: (callback: (value: QueueStateEvent) => void) => {
          mocks.listeners.add(callback);
          return () => mocks.listeners.delete(callback);
        },
      },
    },
  },
}));
const empty: QueueStateEvent = {
  appId: 1,
  activeRun: null,
  queuedRuns: [],
};
const active: QueueStateEvent = {
  appId: 1,
  activeRun: { runId: 1, source: "agent", stopping: false },
  queuedRuns: [{ runId: 2, source: "agent" }],
};
beforeEach(() => {
  mocks.getRunQueue.mockReset();
  mocks.listeners.clear();
});

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
function publish(snapshot: QueueStateEvent) {
  for (const listener of mocks.listeners) listener(snapshot);
}

it("bootstraps once and applies only the selected app's complete events without refetching", async () => {
  mocks.getRunQueue.mockResolvedValue(active);
  const { result, unmount } = renderHook(() => useTestRunQueue(1), {
    wrapper: wrapper(),
  });
  await waitFor(() => expect(result.current.data).toEqual(active));
  act(() => publish({ ...empty, appId: 2 }));
  expect(result.current.data).toEqual(active);
  act(() => publish(empty));
  await waitFor(() => expect(result.current.data).toEqual(empty));
  expect(mocks.getRunQueue).toHaveBeenCalledTimes(1);
  unmount();
  expect(mocks.listeners.size).toBe(0);
});

it("does not overwrite queue events with a stale bootstrap response", async () => {
  let finish!: (value: QueueStateEvent) => void;
  mocks.getRunQueue.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result } = renderHook(() => useTestRunQueue(1), {
    wrapper: wrapper(),
  });
  await waitFor(() => expect(mocks.getRunQueue).toHaveBeenCalledOnce());
  await act(async () => {
    publish(active);
    finish(empty);
  });
  await waitFor(() => expect(result.current.data).toEqual(active));
  expect(mocks.getRunQueue).toHaveBeenCalledOnce();
});

it("refreshes on remount even while the application's default cache would still be fresh", async () => {
  mocks.getRunQueue.mockResolvedValue(active);
  const sharedWrapper = wrapper();
  const first = renderHook(() => useTestRunQueue(1), {
    wrapper: sharedWrapper,
  });
  await waitFor(() => expect(first.result.current.data).toEqual(active));
  first.unmount();
  mocks.getRunQueue.mockResolvedValue(empty);
  const second = renderHook(() => useTestRunQueue(1), {
    wrapper: sharedWrapper,
  });
  await waitFor(() => expect(second.result.current.data).toEqual(empty));
  expect(mocks.getRunQueue).toHaveBeenCalledTimes(2);
});

it("does not fetch or apply events without a selected app", async () => {
  const { result } = renderHook(() => useTestRunQueue(null), {
    wrapper: wrapper(),
  });
  await act(async () => publish(active));
  expect(mocks.getRunQueue).not.toHaveBeenCalled();
  expect(result.current.data).toBeUndefined();
});
