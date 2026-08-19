import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/queryKeys";
import { useDashboardState } from "./useDashboardState";

const mocks = vi.hoisted(() => ({
  settings: null as { storage?: { localVaultPath?: string } } | null,
  infrastructureSnapshot: vi.fn(),
  listDataSources: vi.fn(),
  storageStatus: vi.fn(),
  vectorStart: vi.fn(),
  vectorOverview: vi.fn(),
  listMcpServers: vi.fn(),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: mocks.settings }),
}));

vi.mock("@/hooks/useLanguageModelProviders", () => ({
  useLanguageModelProviders: () => ({
    data: [],
    isProviderSetup: () => false,
  }),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    infrastructure: { snapshot: mocks.infrastructureSnapshot },
    dataSource: { list: mocks.listDataSources },
    storage: { status: mocks.storageStatus },
    vector: {
      start: mocks.vectorStart,
      getOverview: mocks.vectorOverview,
    },
    mcp: { listServers: mocks.listMcpServers },
  },
}));

function testWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const readyVectorOverview = {
  status: {
    state: "ready" as const,
    message: "Ready on this Mac",
    localOnly: true as const,
    error: null,
  },
  collectionCount: 2,
  sourceCount: 4,
  chunkCount: 120,
  storageBytes: 1024,
  embeddingModel: "local",
  lastBackupAt: null,
  activity: [],
  settings: {
    allowCloudRag: false,
    includeHiddenFiles: false,
    defaultResultCount: 10,
    minimumScore: 0.2,
  },
};

describe("useDashboardState", () => {
  beforeEach(() => {
    mocks.settings = null;
    mocks.infrastructureSnapshot.mockReset().mockResolvedValue({
      summary: { healthy: 0, degraded: 0, offline: 0, total: 0 },
    });
    mocks.listDataSources.mockReset().mockResolvedValue([]);
    mocks.storageStatus.mockReset().mockResolvedValue({
      localVaultReady: true,
      cloudConnected: false,
    });
    mocks.vectorStart.mockReset().mockResolvedValue(readyVectorOverview.status);
    mocks.vectorOverview.mockReset().mockResolvedValue(readyVectorOverview);
    mocks.listMcpServers.mockReset().mockResolvedValue([]);
  });

  it("waits for settings and checks the configured vault path", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, rerender } = renderHook(() => useDashboardState(), {
      wrapper: testWrapper(queryClient),
    });

    await waitFor(() => expect(mocks.vectorOverview).toHaveBeenCalledOnce());
    expect(mocks.storageStatus).not.toHaveBeenCalled();

    mocks.settings = {
      storage: { localVaultPath: "  /Volumes/Meta Human Vault  " },
    };
    rerender();

    await waitFor(() =>
      expect(mocks.storageStatus).toHaveBeenCalledWith({
        localVaultPath: "/Volumes/Meta Human Vault",
      }),
    );
    await waitFor(() =>
      expect(
        result.current.health.find((row) => row.id === "storage")?.status,
      ).toBe("Online"),
    );
    expect(
      queryClient.getQueryData(
        queryKeys.storage.status("/Volumes/Meta Human Vault"),
      ),
    ).toEqual({ localVaultReady: true, cloudConnected: false });
  });

  it("starts Vector before caching its overview under the shared key", async () => {
    mocks.settings = {};
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useDashboardState(), {
      wrapper: testWrapper(queryClient),
    });

    await waitFor(() =>
      expect(
        result.current.health.find((row) => row.id === "vector")?.status,
      ).toBe("Ready"),
    );
    expect(mocks.vectorStart).toHaveBeenCalledOnce();
    expect(mocks.vectorStart.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.vectorOverview.mock.invocationCallOrder[0],
    );
    expect(queryClient.getQueryData(queryKeys.vector.overview)).toEqual(
      readyVectorOverview,
    );
  });
});
