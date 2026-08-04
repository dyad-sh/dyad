import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { detectLegacyAppKeyMock, switchAppToPublishableKeyMock } = vi.hoisted(
  () => ({
    detectLegacyAppKeyMock: vi.fn(),
    switchAppToPublishableKeyMock: vi.fn(),
  }),
);

vi.mock("@/ipc/types", () => ({
  ipc: {
    supabase: {
      detectLegacyAppKey: detectLegacyAppKeyMock,
      switchAppToPublishableKey: switchAppToPublishableKeyMock,
    },
  },
}));

import {
  useLegacySupabaseKey,
  useSwitchToPublishableKey,
} from "./useLegacySupabaseKey";
import { queryKeys } from "@/lib/queryKeys";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  detectLegacyAppKeyMock.mockResolvedValue({ hasLegacyKey: true });
  switchAppToPublishableKeyMock.mockResolvedValue({ updated: true });
});

describe("useLegacySupabaseKey", () => {
  it("fetches detection for a connected app", async () => {
    const { wrapper } = makeWrapper();

    const { result } = renderHook(
      () =>
        useLegacySupabaseKey({ appId: 7, projectId: "proj-1", enabled: true }),
      { wrapper },
    );

    await waitFor(() =>
      expect(result.current.data).toEqual({
        hasLegacyKey: true,
      }),
    );
    expect(detectLegacyAppKeyMock).toHaveBeenCalledWith({ appId: 7 });
  });

  it("stays off the wire while disabled", async () => {
    const { wrapper } = makeWrapper();

    renderHook(
      () =>
        useLegacySupabaseKey({ appId: 7, projectId: "proj-1", enabled: false }),
      { wrapper },
    );

    await waitFor(() => expect(detectLegacyAppKeyMock).not.toHaveBeenCalled());
  });

  it("stays off the wire without an app", async () => {
    const { wrapper } = makeWrapper();

    renderHook(
      () =>
        useLegacySupabaseKey({
          appId: null,
          projectId: "proj-1",
          enabled: true,
        }),
      { wrapper },
    );

    await waitFor(() => expect(detectLegacyAppKeyMock).not.toHaveBeenCalled());
  });

  // The verdict belongs to one app/project pairing: repointing a mounted app at
  // another project must not keep showing the previous project's answer.
  it("caches per project, not just per app", async () => {
    const { queryClient, wrapper } = makeWrapper();

    const { rerender } = renderHook(
      ({ projectId }: { projectId: string }) =>
        useLegacySupabaseKey({ appId: 7, projectId, enabled: true }),
      { wrapper, initialProps: { projectId: "proj-1" } },
    );
    await waitFor(() =>
      expect(detectLegacyAppKeyMock).toHaveBeenCalledTimes(1),
    );

    detectLegacyAppKeyMock.mockResolvedValue({ hasLegacyKey: false });
    rerender({ projectId: "proj-2" });

    await waitFor(() =>
      expect(detectLegacyAppKeyMock).toHaveBeenCalledTimes(2),
    );
    expect(
      queryClient.getQueryData(
        queryKeys.supabase.legacyAppKey({ appId: 7, projectId: "proj-2" }),
      ),
    ).toEqual({ hasLegacyKey: false });
  });
});

describe("useSwitchToPublishableKey", () => {
  it("invalidates the app's detection so the banner self-clears", async () => {
    const { queryClient, wrapper } = makeWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useSwitchToPublishableKey(), {
      wrapper,
    });
    await result.current.mutateAsync({ appId: 7 });

    expect(switchAppToPublishableKeyMock).toHaveBeenCalledWith({ appId: 7 });
    // App-scoped prefix, so every project's cached verdict for this app goes.
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: queryKeys.supabase.legacyAppKeyForApp({ appId: 7 }),
      }),
    );
  });

  // The main process commits the rewritten client itself, so the "uncommitted
  // changes" banner and the version list are both stale the moment it returns.
  it("refreshes the app's git views after the switch is committed", async () => {
    const { queryClient, wrapper } = makeWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useSwitchToPublishableKey(), {
      wrapper,
    });
    await result.current.mutateAsync({ appId: 7 });

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: queryKeys.uncommittedFiles.byApp({ appId: 7 }),
      });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: queryKeys.versions.list({ appId: 7 }),
      });
    });
  });

  it("surfaces a failed switch to the caller", async () => {
    const { wrapper } = makeWrapper();
    switchAppToPublishableKeyMock.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useSwitchToPublishableKey(), {
      wrapper,
    });

    await expect(result.current.mutateAsync({ appId: 7 })).rejects.toThrow(
      "boom",
    );
  });
});
