import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkRepoAccess = vi.hoisted(() => vi.fn());
vi.mock("@/ipc/types", () => ({ ipc: { cloudflare: { checkRepoAccess } } }));
vi.mock("@/lib/toast", () => ({ showWarning: vi.fn() }));

const { useCloudflareRepoAccess } = await import("./useCloudflareDeploy");

function renderAccessCheck(queryClient: QueryClient) {
  return renderHook(
    () => useCloudflareRepoAccess({ appId: 7, accountId: "acct-1" }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    },
  );
}

async function wait(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  checkRepoAccess.mockReset();
  checkRepoAccess.mockResolvedValue({ hasAccess: false });
});

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe("waiting for Cloudflare to see the repository", () => {
  it("asks at a steady pace for as long as it takes", async () => {
    renderAccessCheck(new QueryClient());

    await wait(60_000);
    const duringFirstMinute = checkRepoAccess.mock.calls.length;
    expect(duringFirstMinute).toBeGreaterThanOrEqual(6);
    expect(duringFirstMinute).toBeLessThanOrEqual(8);

    await wait(60_000);
    const duringSecondMinute =
      checkRepoAccess.mock.calls.length - duringFirstMinute;
    expect(duringSecondMinute).toBeGreaterThanOrEqual(5);
    expect(duringSecondMinute).toBeLessThanOrEqual(7);
  });

  it("keeps asking after the first check fails", async () => {
    // GitHub or Cloudflare briefly unreachable; the query does not retry.
    checkRepoAccess.mockRejectedValueOnce(new Error("GitHub unreachable"));
    const { result } = renderAccessCheck(
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );

    await wait(25_000);

    expect(checkRepoAccess.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(result.current.data).toEqual({ hasAccess: false });
  });

  it("keeps asking while Dyad is hidden behind the browser", async () => {
    // React Query skips interval refetches for a hidden document by default.
    focusManager.setFocused(false);
    renderAccessCheck(new QueryClient());

    await wait(60_000);

    expect(checkRepoAccess.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it("stops asking once Cloudflare can see it", async () => {
    checkRepoAccess.mockResolvedValue({ hasAccess: true });
    renderAccessCheck(new QueryClient());

    await wait(30_000);

    expect(checkRepoAccess).toHaveBeenCalledTimes(1);
  });
});
