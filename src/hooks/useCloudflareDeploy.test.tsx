import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";

const { checkRepoAccess, saveToken, getAppStatus } = vi.hoisted(() => ({
  checkRepoAccess: vi.fn(),
  saveToken: vi.fn(),
  getAppStatus: vi.fn(),
}));
vi.mock("@/ipc/types", () => ({
  ipc: { cloudflare: { checkRepoAccess, saveToken, getAppStatus } },
}));
vi.mock("@/lib/toast", () => ({ showWarning: vi.fn() }));

const {
  useCloudflareRepoAccess,
  useCloudflareAppStatus,
  useSaveCloudflareToken,
} = await import("./useCloudflareDeploy");

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

it("keeps a mounted deployment observer connected after saving a token", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const unconnected = { synced: true, targets: [], connections: [] };
  getAppStatus.mockResolvedValue(unconnected);
  saveToken.mockResolvedValue(undefined);
  queryClient.setQueryData(queryKeys.cloudflare.accounts, [
    { id: "old-token-account" },
  ]);
  const wizard = renderHook(() => useCloudflareAppStatus({ appId: 7 }), {
    wrapper,
  });
  const tokenForm = renderHook(() => useSaveCloudflareToken(), { wrapper });
  await wait(1);
  expect(wizard.result.current.data).toEqual(unconnected);

  await act(async () => {
    await tokenForm.result.current.mutateAsync("new-token");
  });
  await wait(1);
  expect(
    queryClient.getQueryData(queryKeys.cloudflare.accounts),
  ).toBeUndefined();

  // The connector mounts its authenticated content after token setup while
  // the wizard's status observer stays mounted throughout.
  const connector = renderHook(() => useCloudflareAppStatus({ appId: 7 }), {
    wrapper,
  });
  await wait(1);
  const connected = {
    ...unconnected,
    connections: [{ rootDirectory: "worker" }],
  };
  getAppStatus.mockResolvedValue(connected);
  await act(async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.cloudflare.appStatus({ appId: 7 }),
    });
  });
  await wait(1);

  expect(connector.result.current.data).toEqual(connected);
  expect(wizard.result.current.data).toEqual(connected);
  queryClient.clear();
});
