import {
  type InfiniteData,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { renderHook, act, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Version } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useVersions } from "./useVersions";

const {
  getChatMock,
  listVersionsMock,
  restartAppMock,
  revertVersionMock,
  setVersionFavoriteMock,
  setVersionNoteMock,
} = vi.hoisted(() => ({
  getChatMock: vi.fn(),
  listVersionsMock: vi.fn(),
  restartAppMock: vi.fn(),
  revertVersionMock: vi.fn(),
  setVersionFavoriteMock: vi.fn(),
  setVersionNoteMock: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    chat: {
      getChat: getChatMock,
    },
    version: {
      listVersions: listVersionsMock,
      revertVersion: revertVersionMock,
      setVersionFavorite: setVersionFavoriteMock,
      setVersionNote: setVersionNoteMock,
    },
  },
}));

vi.mock("./useRunApp", () => ({
  useRunApp: () => ({
    restartApp: restartAppMock,
  }),
}));

vi.mock("./useSettings", () => ({
  useSettings: () => ({
    settings: undefined,
  }),
}));

function makeWrapper(queryClient: QueryClient) {
  const store = createStore();

  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </Provider>
    );
  };
}

describe("useVersions", () => {
  beforeEach(() => {
    getChatMock.mockReset();
    listVersionsMock.mockReset();
    restartAppMock.mockReset();
    revertVersionMock.mockReset();
    setVersionFavoriteMock.mockReset();
    setVersionNoteMock.mockReset();
  });

  it("updates the versions query cache after saving a note", async () => {
    const appId = 42;
    const oid = "a".repeat(40);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    const version: Version = {
      oid,
      message: "Initial version",
      timestamp: 1,
      dbTimestamp: null,
      isFavorite: false,
      note: null,
    };
    type VersionPage = {
      versions: Version[];
      nextCursor: string | null;
      totalCount: number | null;
    };
    queryClient.setQueryData<InfiniteData<VersionPage>>(
      queryKeys.versions.list({ appId }),
      {
        pages: [{ versions: [version], nextCursor: null, totalCount: 1 }],
        pageParams: [undefined],
      },
    );
    setVersionNoteMock.mockResolvedValue({
      oid,
      isFavorite: false,
      note: "Launch note",
    });

    const { result } = renderHook(() => useVersions(appId), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.setVersionNote({
        appId,
        versionId: oid,
        note: "Launch note",
      });
    });

    expect(setVersionNoteMock).toHaveBeenCalledWith({
      appId,
      versionId: oid,
      note: "Launch note",
    });
    expect(
      queryClient.getQueryData<InfiniteData<VersionPage>>(
        queryKeys.versions.list({ appId }),
      )?.pages[0].versions[0],
    ).toMatchObject({
      oid,
      note: "Launch note",
      isFavorite: false,
    });
  });

  it("loads version history one bounded cursor page at a time", async () => {
    const appId = 42;
    const firstOid = "a".repeat(40);
    const nextOid = "b".repeat(40);
    const nextCursor = { head: firstOid, offset: 1 };
    const makeVersion = (oid: string, message: string): Version => ({
      oid,
      message,
      timestamp: 1,
      dbTimestamp: null,
      isFavorite: false,
      note: null,
    });
    listVersionsMock
      .mockResolvedValueOnce({
        versions: [makeVersion(firstOid, "newest")],
        nextCursor,
        totalCount: 2,
      })
      .mockResolvedValueOnce({
        versions: [makeVersion(nextOid, "oldest")],
        nextCursor: null,
        totalCount: null,
      });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useVersions(appId), {
      wrapper: makeWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.versions).toHaveLength(1));
    expect(result.current.totalVersionCount).toBe(2);
    expect(result.current.hasMoreVersions).toBe(true);

    await act(async () => {
      await result.current.loadMoreVersions();
    });

    expect(listVersionsMock).toHaveBeenNthCalledWith(1, {
      appId,
      cursor: undefined,
      limit: 100,
    });
    expect(listVersionsMock).toHaveBeenNthCalledWith(2, {
      appId,
      cursor: nextCursor,
      limit: 100,
    });
    await waitFor(() =>
      expect(result.current.versions.map((version) => version.oid)).toEqual([
        firstOid,
        nextOid,
      ]),
    );
    expect(result.current.hasMoreVersions).toBe(false);
  });

  it("stops retaining history after the client page budget", async () => {
    const appId = 42;
    const oidFor = (index: number) => index.toString(16).padStart(40, "0");
    listVersionsMock.mockImplementation(
      async ({ cursor }: { cursor?: { head: string; offset: number } }) => {
        const index = cursor?.offset ?? 0;
        return {
          versions: [
            {
              oid: oidFor(index),
              message: `version ${index}`,
              timestamp: index,
              dbTimestamp: null,
              isFavorite: false,
              note: null,
            },
          ],
          nextCursor: { head: oidFor(0), offset: index + 1 },
          totalCount: cursor ? null : 10_000,
        };
      },
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useVersions(appId), {
      wrapper: makeWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.versions).toHaveLength(1));

    for (let page = 1; page < 20; page++) {
      await act(async () => {
        await result.current.loadMoreVersions();
      });
    }
    await waitFor(() => expect(result.current.versions).toHaveLength(20));

    expect(result.current.hasMoreVersions).toBe(false);
    expect(result.current.versionHistoryLimitReached).toBe(true);
    expect(listVersionsMock).toHaveBeenCalledTimes(20);
  });

  it("does not report the retention limit from a stale total count", async () => {
    listVersionsMock.mockResolvedValue({
      versions: [],
      nextCursor: null,
      totalCount: 1,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useVersions(42), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.versionHistoryLimitReached).toBe(false);
  });
});
