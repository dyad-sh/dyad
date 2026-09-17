import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { useTestRunQueue } from "./useTestRunQueue";

const mocks = vi.hoisted(() => ({
  getRunQueue: vi.fn(),
  listeners: new Set<(value: { appId: number }) => void>(),
}));
vi.mock("@/ipc/types", () => ({
  ipc: {
    tests: { getRunQueue: mocks.getRunQueue },
    events: {
      tests: {
        onQueueState: (callback: (value: { appId: number }) => void) => {
          mocks.listeners.add(callback);
          return () => mocks.listeners.delete(callback);
        },
      },
    },
  },
}));
const empty = { activeRun: null, queuedRuns: [] };
const active = {
  activeRun: { runId: 1, source: "agent", stopping: false },
  queuedRuns: [{ runId: 2, source: "agent" }],
};
beforeEach(() => {
  mocks.getRunQueue.mockReset();
  mocks.listeners.clear();
});

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

it("loads the main snapshot on mount and refreshes only for the selected app", async () => {
  mocks.getRunQueue.mockResolvedValue(active);
  const { result, unmount } = renderHook(() => useTestRunQueue(1), {
    wrapper: wrapper(),
  });
  await waitFor(() => expect(result.current.data).toEqual(active));
  act(() => {
    for (const listener of mocks.listeners) listener({ appId: 2 });
  });
  expect(mocks.getRunQueue).toHaveBeenCalledTimes(1);
  mocks.getRunQueue.mockResolvedValue(empty);
  act(() => {
    for (const listener of mocks.listeners) listener({ appId: 1 });
  });
  await waitFor(() => expect(result.current.data).toEqual(empty));
  unmount();
  expect(mocks.listeners.size).toBe(0);
});

it("does not overwrite a queue change with a stale bootstrap response", async () => {
  let finish!: (value: typeof empty) => void;
  mocks.getRunQueue
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(active);
  const { result } = renderHook(() => useTestRunQueue(1), {
    wrapper: wrapper(),
  });
  await waitFor(() => expect(mocks.getRunQueue).toHaveBeenCalledOnce());
  await act(async () => {
    for (const listener of mocks.listeners) listener({ appId: 1 });
    finish(empty);
  });
  await waitFor(() => expect(result.current.data).toEqual(active));
});
