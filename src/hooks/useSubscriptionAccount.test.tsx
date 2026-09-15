import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useSubscriptionAccount } from "./useSubscriptionAccount";

const { status } = vi.hoisted(() => ({
  status: vi.fn(async () => ({ connected: true, pending: false })),
}));
vi.mock("@/ipc/types", () => ({
  ipc: { settings: { getCodexSubscriptionStatus: status } },
}));

let client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers();
  status.mockReset();
  status.mockResolvedValue({ connected: true, pending: false });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
});
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

it("polls idle accounts every thirty minutes", async () => {
  renderHook(() => useSubscriptionAccount(), { wrapper });
  await advance(1);
  expect(status).toHaveBeenCalledTimes(1);
  await advance(29 * 60_000);
  expect(status).toHaveBeenCalledTimes(1);
  await advance(60_000);
  expect(status).toHaveBeenCalledTimes(2);
});

it("refreshes on menu open, polls while open, and slows down after close", async () => {
  const { rerender } = renderHook(({ open }) => useSubscriptionAccount(open), {
    wrapper,
    initialProps: { open: false },
  });
  await advance(1);
  rerender({ open: true });
  await advance(1);
  expect(status).toHaveBeenCalledTimes(2);
  await advance(30_000);
  expect(status).toHaveBeenCalledTimes(3);
  rerender({ open: false });
  await advance(60_000);
  expect(status).toHaveBeenCalledTimes(3);
});

it("keeps sign-in completion polling responsive with the menu closed", async () => {
  status.mockResolvedValue({ connected: false, pending: true });
  renderHook(() => useSubscriptionAccount(), { wrapper });
  await advance(10);
  await advance(1500);
  expect(status).toHaveBeenCalledTimes(2);
});
