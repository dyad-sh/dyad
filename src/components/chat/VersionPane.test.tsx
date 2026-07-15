import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type React from "react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom, selectedVersionIdAtom } from "@/atoms/appAtoms";
import type { Version } from "@/ipc/types";
import { VersionPane } from "./VersionPane";

const {
  checkoutVersionMock,
  listAppScreenshotsMock,
  refetchBranchInfoMock,
  refreshAppMock,
  refreshVersionsMock,
  restartAppMock,
  revertVersionMock,
  setVersionFavoriteMock,
  setVersionNoteMock,
  showErrorMock,
  versionsMock,
} = vi.hoisted(() => ({
  checkoutVersionMock: vi.fn(),
  listAppScreenshotsMock: vi.fn(),
  refetchBranchInfoMock: vi.fn(),
  refreshAppMock: vi.fn(),
  refreshVersionsMock: vi.fn(),
  restartAppMock: vi.fn(),
  revertVersionMock: vi.fn(),
  setVersionFavoriteMock: vi.fn(),
  setVersionNoteMock: vi.fn(),
  showErrorMock: vi.fn(),
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
    branchInfo: undefined,
    isLoading: false,
    refetchBranchInfo: refetchBranchInfoMock,
  }),
}));

vi.mock("@/lib/toast", () => ({
  showError: showErrorMock,
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

function makeWrapper(store = createStore()) {
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
    listAppScreenshotsMock.mockReset();
    refetchBranchInfoMock.mockReset();
    refreshAppMock.mockReset();
    refreshVersionsMock.mockReset();
    restartAppMock.mockReset();
    revertVersionMock.mockReset();
    setVersionFavoriteMock.mockReset();
    setVersionNoteMock.mockReset();
    showErrorMock.mockReset();

    versionsMock.length = 0;
    listAppScreenshotsMock.mockResolvedValue({ screenshots: [] });
    refetchBranchInfoMock.mockResolvedValue({ data: { branch: "main" } });
  });

  it("renders a large version list through the virtualizer", async () => {
    const versionCount = 1_000;
    versionsMock.push(
      ...Array.from({ length: versionCount }, (_, index) => makeVersion(index)),
    );
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });

    render(<VersionPane isVisible onClose={vi.fn()} onOpen={vi.fn()} />, {
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

  it("restores selected versions on the branch active before checkout", async () => {
    refetchBranchInfoMock.mockResolvedValue({
      data: { branch: "feature/test" },
    });
    const version = makeVersion(1);
    versionsMock.push(version);
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });

    render(<VersionPane isVisible onClose={vi.fn()} onOpen={vi.fn()} />, {
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

  it("returns to the captured branch when version history closes", async () => {
    refetchBranchInfoMock.mockResolvedValue({
      data: { branch: "feature/test" },
    });
    const version = makeVersion(1);
    versionsMock.push(version);
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });

    const { rerender } = render(
      <VersionPane isVisible onClose={vi.fn()} onOpen={vi.fn()} />,
      { wrapper: makeWrapper() },
    );

    fireEvent.click(await screen.findByTestId("version-row-1"));
    await waitFor(() => {
      expect(checkoutVersionMock).toHaveBeenCalledWith({
        appId: 1,
        versionId: version.oid,
      });
    });

    rerender(
      <VersionPane isVisible={false} onClose={vi.fn()} onOpen={vi.fn()} />,
    );

    await waitFor(() => {
      expect(checkoutVersionMock).toHaveBeenLastCalledWith({
        appId: 1,
        versionId: "feature/test",
      });
    });
    expect(checkoutVersionMock).not.toHaveBeenCalledWith({
      appId: 1,
      versionId: "main",
    });
  });

  it("does not preview a version when the current branch is unavailable", async () => {
    refetchBranchInfoMock.mockResolvedValue({
      data: { branch: "<no-branch>" },
    });
    const version = makeVersion(1);
    versionsMock.push(version);
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });

    render(<VersionPane isVisible onClose={vi.fn()} onOpen={vi.fn()} />, {
      wrapper: makeWrapper(),
    });

    fireEvent.click(await screen.findByTestId("version-row-1"));

    await waitFor(() => {
      expect(refetchBranchInfoMock).toHaveBeenCalled();
      expect(showErrorMock).toHaveBeenCalledWith(
        "Unable to determine the current Git branch. Version preview was cancelled to avoid switching branches.",
      );
    });
    expect(checkoutVersionMock).not.toHaveBeenCalled();
  });

  it("shows the selected version while resolving the return branch", async () => {
    let resolveBranchInfo!: (value: { data: { branch: string } }) => void;
    refetchBranchInfoMock.mockReturnValue(
      new Promise((resolve) => {
        resolveBranchInfo = resolve;
      }),
    );
    const version = makeVersion(1);
    versionsMock.push(version);
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });
    const store = createStore();

    render(<VersionPane isVisible onClose={vi.fn()} onOpen={vi.fn()} />, {
      wrapper: makeWrapper(store),
    });

    fireEvent.click(await screen.findByTestId("version-row-1"));

    expect(store.get(selectedVersionIdAtom)).toBe(version.oid);
    expect(checkoutVersionMock).not.toHaveBeenCalled();

    resolveBranchInfo({ data: { branch: "feature/test" } });
    await waitFor(() => {
      expect(checkoutVersionMock).toHaveBeenCalledWith({
        appId: 1,
        versionId: version.oid,
      });
    });
  });

  it("cancels a pending version preview when version history closes", async () => {
    let resolveBranchInfo!: (value: { data: { branch: string } }) => void;
    refetchBranchInfoMock.mockReturnValue(
      new Promise((resolve) => {
        resolveBranchInfo = resolve;
      }),
    );
    const version = makeVersion(1);
    versionsMock.push(version);
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });
    const { rerender } = render(
      <VersionPane isVisible onClose={vi.fn()} onOpen={vi.fn()} />,
      { wrapper: makeWrapper() },
    );

    fireEvent.click(await screen.findByTestId("version-row-1"));
    rerender(
      <VersionPane isVisible={false} onClose={vi.fn()} onOpen={vi.fn()} />,
    );

    await act(async () => {
      resolveBranchInfo({ data: { branch: "feature/test" } });
    });

    expect(checkoutVersionMock).not.toHaveBeenCalled();
    expect(showErrorMock).not.toHaveBeenCalled();
  });

  it("ignores an older preview after another version is selected", async () => {
    const branchResolvers: Array<
      (value: { data: { branch: string } }) => void
    > = [];
    refetchBranchInfoMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          branchResolvers.push(resolve);
        }),
    );
    const olderVersion = makeVersion(1);
    const newerVersion = makeVersion(2);
    versionsMock.push(olderVersion, newerVersion);
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });

    render(<VersionPane isVisible onClose={vi.fn()} onOpen={vi.fn()} />, {
      wrapper: makeWrapper(),
    });

    fireEvent.click(await screen.findByTestId("version-row-2"));
    fireEvent.click(screen.getByTestId("version-row-1"));

    await act(async () => {
      branchResolvers[1]({ data: { branch: "feature/test" } });
    });
    await waitFor(() => {
      expect(checkoutVersionMock).toHaveBeenCalledWith({
        appId: 1,
        versionId: newerVersion.oid,
      });
    });

    await act(async () => {
      branchResolvers[0]({ data: { branch: "feature/test" } });
    });
    expect(checkoutVersionMock).not.toHaveBeenCalledWith({
      appId: 1,
      versionId: olderVersion.oid,
    });
  });

  it("offers to reopen version history when the return branch is unavailable", async () => {
    const version = makeVersion(1);
    versionsMock.push(version);
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });
    const store = createStore();
    const onOpen = vi.fn();
    const { rerender } = render(
      <VersionPane isVisible onClose={vi.fn()} onOpen={onOpen} />,
      { wrapper: makeWrapper(store) },
    );

    fireEvent.click(await screen.findByTestId("version-row-1"));
    await waitFor(() => {
      expect(checkoutVersionMock).toHaveBeenCalledWith({
        appId: 1,
        versionId: version.oid,
      });
    });

    act(() => {
      store.set(selectedAppIdAtom, 2);
    });
    rerender(
      <VersionPane isVisible={false} onClose={vi.fn()} onOpen={onOpen} />,
    );

    await waitFor(() => {
      expect(showErrorMock).toHaveBeenCalledWith(
        "Unable to determine the branch to return to. Dyad left the current version checked out instead of switching branches.",
        {
          action: {
            label: "Reopen Version History",
            onClick: onOpen,
          },
        },
      );
    });

    const action = showErrorMock.mock.calls.at(-1)?.[1]?.action;
    action?.onClick();
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
