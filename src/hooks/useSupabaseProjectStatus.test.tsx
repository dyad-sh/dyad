import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectStatus: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    supabase: { getProjectStatus: mocks.getProjectStatus },
  },
  SUPABASE_PROJECT_STATUS_PROVISIONING: "COMING_UP",
}));

import { useSupabaseProjectStatus } from "./useSupabase";

const PROVISIONING = {
  projectId: "proj-1",
  status: "COMING_UP",
};
const READY = {
  projectId: "proj-1",
  status: "ACTIVE_HEALTHY",
};

// One client for the whole test, mirroring the app's real defaults from
// src/renderer.tsx. Both details matter: a per-render client would give every
// "remount" an empty cache, and the default staleTime of 0 would make mounts
// refetch when the app's 60s window says they should not — either would let a
// test claim a recovery the app does not actually perform.
let queryClient: QueryClient;

function renderStatus() {
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useSupabaseProjectStatus({
        projectId: "proj-1",
        organizationSlug: "org-1",
      }),
    { wrapper },
  );
}

/** Advance fake time far enough for `count` poll ticks, retries included. */
async function advanceTicks(count: number) {
  for (let i = 0; i < count; i++) {
    await vi.advanceTimersByTimeAsync(5_000);
    // Drain the in-tick retry backoff so a failing tick reaches its verdict.
    await vi.advanceTimersByTimeAsync(4_000);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, retry: false } },
  });
  // `shouldAdvanceTime` keeps Testing Library's `waitFor` from deadlocking:
  // it polls on real time, which frozen fake timers never deliver.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSupabaseProjectStatus", () => {
  it("reports a provisioning project and keeps polling", async () => {
    mocks.getProjectStatus.mockResolvedValue(PROVISIONING);

    const { result } = renderStatus();
    await waitFor(() => expect(result.current.isProvisioning).toBe(true));

    // The scoping this hook exists for: a dropped or swapped payload would
    // otherwise poll about the wrong project and still look green.
    expect(mocks.getProjectStatus).toHaveBeenCalledWith({
      projectId: "proj-1",
      organizationSlug: "org-1",
    });

    const afterFirst = mocks.getProjectStatus.mock.calls.length;
    await advanceTicks(2);
    expect(mocks.getProjectStatus.mock.calls.length).toBeGreaterThan(
      afterFirst,
    );
  });

  it("does not poll a project that is already serving", async () => {
    mocks.getProjectStatus.mockResolvedValue(READY);

    const { result } = renderStatus();
    await waitFor(() => expect(result.current.status).toBe("ACTIVE_HEALTHY"));
    expect(result.current.isProvisioning).toBe(false);

    const afterFirst = mocks.getProjectStatus.mock.calls.length;
    await advanceTicks(3);
    // One request per mount for a ready project, never a poll.
    expect(mocks.getProjectStatus.mock.calls.length).toBe(afterFirst);
  });

  // The regression this file exists for. A previous attempt bounded the poll on
  // `fetchFailureCount`, which React Query resets at the start of every fetch —
  // so the counter never accumulated, the guard never fired, and the connector
  // kept calling the Management API every 5s forever on a project whose status
  // endpoint had gone dark.
  it("stops polling once the status endpoint stays down", async () => {
    mocks.getProjectStatus.mockResolvedValueOnce(PROVISIONING);
    mocks.getProjectStatus.mockRejectedValue(new Error("project not found"));

    const { result } = renderStatus();
    await waitFor(() => expect(result.current.isProvisioning).toBe(true));

    // Let the failures play out well past any plausible give-up point.
    await advanceTicks(6);
    const settled = mocks.getProjectStatus.mock.calls.length;
    await advanceTicks(6);

    expect(mocks.getProjectStatus.mock.calls.length).toBe(settled);
    // And the banner comes down rather than promising a project that is coming.
    expect(result.current.isProvisioning).toBe(false);
  });

  // The accepted cost of having no renderer-side retry. A renderer retry would
  // multiply `fetchWithRetry`'s own budget in the main process, and cancelling
  // one mid-backoff (which React Query does on any navigation away from the
  // panel) drops the query into terminal error after a single failure anyway.
  // So a blip stops the poll early, which is cosmetic: the project keeps
  // provisioning and the next mount re-checks it.
  it("gives up on a transient failure rather than retrying in the renderer", async () => {
    mocks.getProjectStatus.mockResolvedValueOnce(PROVISIONING);
    mocks.getProjectStatus.mockRejectedValueOnce(new Error("502 bad gateway"));
    mocks.getProjectStatus.mockResolvedValue(PROVISIONING);

    const { result } = renderStatus();
    await waitFor(() => expect(result.current.isProvisioning).toBe(true));

    await advanceTicks(3);
    const settled = mocks.getProjectStatus.mock.calls.length;
    await advanceTicks(3);

    // One attempt per tick, and no further ticks after the failure.
    expect(mocks.getProjectStatus.mock.calls.length).toBe(settled);
    expect(result.current.isProvisioning).toBe(false);
  });

  // A remount is the recovery path for the case above, so it has to actually
  // re-check. Seeded through the real sequence — a success, then a failed tick —
  // because that is the only way the poll can be running when it breaks, and it
  // leaves cached data behind that a naive mount would serve instead of
  // refetching.
  it("re-checks when the panel is reopened after a failure", async () => {
    mocks.getProjectStatus.mockResolvedValueOnce(PROVISIONING);
    mocks.getProjectStatus.mockRejectedValueOnce(new Error("502 bad gateway"));
    mocks.getProjectStatus.mockResolvedValue(PROVISIONING);

    const first = renderStatus();
    await waitFor(() => expect(first.result.current.isProvisioning).toBe(true));
    await advanceTicks(2);
    await waitFor(() =>
      expect(first.result.current.isProvisioning).toBe(false),
    );
    const beforeRemount = mocks.getProjectStatus.mock.calls.length;
    first.unmount();

    const second = renderStatus();

    await waitFor(() =>
      expect(mocks.getProjectStatus.mock.calls.length).toBeGreaterThan(
        beforeRemount,
      ),
    );
    expect(mocks.getProjectStatus).toHaveBeenLastCalledWith({
      projectId: "proj-1",
      organizationSlug: "org-1",
    });
    await waitFor(() =>
      expect(second.result.current.isProvisioning).toBe(true),
    );
  });
});
