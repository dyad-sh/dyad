import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
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
    queryClient.setQueryData(queryKeys.versions.list({ appId }), [version]);
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
      queryClient.getQueryData<Version[]>(
        queryKeys.versions.list({ appId }),
      )?.[0],
    ).toMatchObject({
      oid,
      note: "Launch note",
      isFavorite: false,
    });
  });
});
