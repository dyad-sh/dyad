import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type React from "react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import type { Version } from "@/ipc/types";
import { VersionPane } from "./VersionPane";

const {
  checkoutVersionMock,
  currentBranchMock,
  hasMoreVersionsMock,
  listAppScreenshotsMock,
  loadMoreVersionsMock,
  refreshAppMock,
  refreshVersionsMock,
  restartAppMock,
  revertVersionMock,
  setVersionFavoriteMock,
  setVersionNoteMock,
  versionsMock,
} = vi.hoisted(() => ({
  checkoutVersionMock: vi.fn(),
  currentBranchMock: { branch: "main" },
  hasMoreVersionsMock: { value: false },
  listAppScreenshotsMock: vi.fn(),
  loadMoreVersionsMock: vi.fn(),
  refreshAppMock: vi.fn(),
  refreshVersionsMock: vi.fn(),
  restartAppMock: vi.fn(),
  revertVersionMock: vi.fn(),
  setVersionFavoriteMock: vi.fn(),
  setVersionNoteMock: vi.fn(),
  versionsMock: [] as Version[],
}));

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    computeItemKey,
    data,
    itemContent,
  }: {
    computeItemKey?: (index: number, item: Version) => string;
    data: Version[];
    itemContent: (index: number, item: Version) => React.ReactNode;
  }) => (
    <div data-testid="virtualized-version-list" data-total-count={data.length}>
      {data.slice(0, 20).map((item, index) => (
        <div key={computeItemKey?.(index, item) ?? item.oid}>
          {itemContent(index, item)}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@/ipc/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/types")>()),
  ipc: {
    app: {
      listAppScreenshots: listAppScreenshotsMock,
    },
  },
}));

vi.mock("@/hooks/useVersions", () => ({
  useVersions: () => ({
    versions: versionsMock,
    totalVersionCount: versionsMock.length,
    hasMoreVersions: hasMoreVersionsMock.value,
    versionHistoryLimitReached: false,
    loadMoreVersions: loadMoreVersionsMock,
    isLoadingMoreVersions: false,
    loading: false,
    error: null,
    refreshVersions: refreshVersionsMock,
    revertVersion: revertVersionMock,
    isRevertingVersion: false,
    setVersionFavorite: setVersionFavoriteMock,
    isSettingVersionFavorite: false,
    setVersionNote: setVersionNoteMock,
    isSettingVersionNote: false,
  }),
}));

vi.mock("@/hooks/useCheckoutVersion", () => ({
  useCheckoutVersion: () => ({
    checkoutVersion: checkoutVersionMock,
    isCheckingOutVersion: false,
  }),
}));

vi.mock("@/hooks/useCurrentBranch", () => ({
  useCurrentBranch: () => ({
    branchInfo: currentBranchMock,
    isLoading: false,
    refetchBranchInfo: vi.fn(),
  }),
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({
    app: null,
    loading: false,
    error: null,
    refreshApp: refreshAppMock,
  }),
}));

vi.mock("@/hooks/useRunApp", () => ({
  useRunApp: () => ({
    restartApp: restartAppMock,
  }),
}));

function makeVersion(index: number): Version {
  return {
    oid: index.toString(16).padStart(40, "0"),
    message: `Version message ${index}`,
    timestamp: 1_700_000_000 + index,
    dbTimestamp: null,
    isFavorite: false,
    note: null,
  };
}

function makeWrapper() {
  const store = createStore();
  store.set(selectedAppIdAtom, 1);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

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

describe("VersionPane", () => {
  beforeEach(() => {
    checkoutVersionMock.mockReset();
    loadMoreVersionsMock.mockReset();
    listAppScreenshotsMock.mockReset();
    refreshAppMock.mockReset();
    refreshVersionsMock.mockReset();
    restartAppMock.mockReset();
    revertVersionMock.mockReset();
    setVersionFavoriteMock.mockReset();
    setVersionNoteMock.mockReset();

    versionsMock.length = 0;
    hasMoreVersionsMock.value = false;
    currentBranchMock.branch = "main";
    listAppScreenshotsMock.mockResolvedValue({ screenshots: [] });
  });

  it("renders a large version list through the virtualizer", async () => {
    const versionCount = 1_000;
    versionsMock.push(
      ...Array.from({ length: versionCount }, (_, index) => makeVersion(index)),
    );
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });

    render(<VersionPane isVisible onClose={vi.fn()} />, {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(
        screen
          .getByTestId("virtualized-version-list")
          .getAttribute("data-total-count"),
      ).toBe(String(versionCount));
    });
    expect(screen.getAllByTestId(/^version-row-/)).toHaveLength(20);
  });

  it("loads older versions only when requested", async () => {
    versionsMock.push(makeVersion(2));
    hasMoreVersionsMock.value = true;
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });
    loadMoreVersionsMock.mockResolvedValue(undefined);

    render(<VersionPane isVisible onClose={vi.fn()} />, {
      wrapper: makeWrapper(),
    });

    fireEvent.click(await screen.findByText("Load older versions"));
    expect(loadMoreVersionsMock).toHaveBeenCalledTimes(1);
  });

  it("restores selected versions on the branch active before checkout", async () => {
    currentBranchMock.branch = "feature/test";
    const version = makeVersion(1);
    versionsMock.push(version);
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });

    render(<VersionPane isVisible onClose={vi.fn()} />, {
      wrapper: makeWrapper(),
    });

    fireEvent.click(await screen.findByTestId("version-row-1"));

    await waitFor(() => {
      expect(checkoutVersionMock).toHaveBeenCalledWith({
        appId: 1,
        versionId: version.oid,
      });
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Restore to this version" }),
    );

    await waitFor(() => {
      expect(revertVersionMock).toHaveBeenCalledWith({
        versionId: version.oid,
        targetBranchName: "feature/test",
      });
    });
  });
});
