import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { queryKeys } from "@/lib/queryKeys";

const { previewAppFolderNameMock } = vi.hoisted(() => ({
  previewAppFolderNameMock: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: { app: { previewAppFolderName: previewAppFolderNameMock } },
}));

import { useAppFolderPreview } from "./useAppFolderPreview";

// The production renderer (src/renderer.tsx) sets staleTime: 60_000 and no
// gcTime, so the React Query v5 default 5-minute gcTime governs eviction. This
// client mirrors that cache shape so a cached entry survives an unmount/remount
// the same way it does in the app.
function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 5 * 60 * 1000, staleTime: 0 },
    },
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAppFolderPreview", () => {
  it("returns the resolved folder name", async () => {
    previewAppFolderNameMock.mockResolvedValue({ folderName: "my-app" });
    const client = makeClient();

    const { result } = renderHook(() => useAppFolderPreview("my-app"), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.data).toBe("my-app"));
    expect(previewAppFolderNameMock).toHaveBeenCalledWith({
      name: "my-app",
      appId: undefined,
    });
  });

  it("stays off the wire for a blank name", () => {
    previewAppFolderNameMock.mockResolvedValue({ folderName: "x" });
    const client = makeClient();

    renderHook(() => useAppFolderPreview("   "), {
      wrapper: makeWrapper(client),
    });

    expect(previewAppFolderNameMock).not.toHaveBeenCalled();
  });

  it("does not refetch on remount while the entry is cached", async () => {
    // The hook sets refetchOnMount: false so reopening a dialog with the same
    // name never spams the IPC. This is the intent that the fix preserves: the
    // purge (not a refetch trigger) is what clears a stale entry.
    previewAppFolderNameMock.mockResolvedValue({ folderName: "my-app" });
    const client = makeClient();

    const { unmount } = renderHook(() => useAppFolderPreview("my-app"), {
      wrapper: makeWrapper(client),
    });
    await waitFor(() =>
      expect(previewAppFolderNameMock).toHaveBeenCalledTimes(1),
    );

    unmount();
    renderHook(() => useAppFolderPreview("my-app"), {
      wrapper: makeWrapper(client),
    });
    await waitFor(() =>
      expect(previewAppFolderNameMock).toHaveBeenCalledTimes(1),
    );
  });

  it("invalidation alone does not refresh a cached entry (refetchOnMount is false)", async () => {
    // Why the fix purges instead of invalidating: invalidateQueries marks the
    // entry stale, but refetchOnMount: false still serves that stale entry
    // verbatim on the next mount. With the hook options unchanged, an app-name
    // invalidation must therefore remove the entry, not just mark it.
    previewAppFolderNameMock.mockResolvedValue({ folderName: "my-app-2" });
    const client = makeClient();

    const { unmount } = renderHook(() => useAppFolderPreview("my-app"), {
      wrapper: makeWrapper(client),
    });
    await waitFor(() =>
      expect(previewAppFolderNameMock).toHaveBeenCalledTimes(1),
    );

    unmount();
    // Mark stale the way a naive invalidate-only fix would.
    client.invalidateQueries({ queryKey: queryKeys.appName.folderPreviewAll });
    previewAppFolderNameMock.mockResolvedValue({ folderName: "my-app" });

    renderHook(() => useAppFolderPreview("my-app"), {
      wrapper: makeWrapper(client),
    });

    // Still exactly one call: the stale entry was served on remount.
    await waitFor(() =>
      expect(previewAppFolderNameMock).toHaveBeenCalledTimes(1),
    );
  });

  it("refetches after the app-name cache is purged (lifecycle invalidation)", async () => {
    // The RendererQueryInvalidationConsumer removes (not invalidates) app-name
    // query keys when an app lifecycle mutation publishes {family:"app-name"}.
    // A fresh fetch then runs on the next mount regardless of refetchOnMount,
    // because there is no cached entry to serve.
    previewAppFolderNameMock.mockResolvedValue({ folderName: "my-app-2" });
    const client = makeClient();

    const { unmount } = renderHook(() => useAppFolderPreview("my-app"), {
      wrapper: makeWrapper(client),
    });
    await waitFor(() =>
      expect(previewAppFolderNameMock).toHaveBeenCalledTimes(1),
    );

    unmount();
    // Mirror the consumer: purge every app-name entry by its root prefix.
    client.removeQueries({ queryKey: queryKeys.appName.folderPreviewAll });
    previewAppFolderNameMock.mockResolvedValue({ folderName: "my-app" });

    const { result } = renderHook(() => useAppFolderPreview("my-app"), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() =>
      expect(previewAppFolderNameMock).toHaveBeenCalledTimes(2),
    );
    await waitFor(() => expect(result.current.data).toBe("my-app"));
  });

  it("purges per-appId rename entries too", async () => {
    // The rename flow keys the preview by appId so the app's own folder is
    // excluded from collision probing. The folderPreviewAll root must cover
    // those entries, or deleting a different app would not refresh a rename
    // dialog that had cached a collision against it.
    previewAppFolderNameMock.mockResolvedValue({ folderName: "test-2" });
    const client = makeClient();

    const { unmount } = renderHook(() => useAppFolderPreview("test", 42), {
      wrapper: makeWrapper(client),
    });
    await waitFor(() =>
      expect(previewAppFolderNameMock).toHaveBeenCalledWith({
        name: "test",
        appId: 42,
      }),
    );

    unmount();
    client.removeQueries({ queryKey: queryKeys.appName.folderPreviewAll });
    previewAppFolderNameMock.mockResolvedValue({ folderName: "test" });

    const { result } = renderHook(() => useAppFolderPreview("test", 42), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() =>
      expect(previewAppFolderNameMock).toHaveBeenCalledTimes(2),
    );
    await waitFor(() => expect(result.current.data).toBe("test"));
  });
});
