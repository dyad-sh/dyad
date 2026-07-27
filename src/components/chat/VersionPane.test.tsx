import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type React from "react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import type { Version } from "@/ipc/types";
import type { PreviewState } from "@/version_preview/state";
import { projectVersionPreview } from "@/version_preview/projection";
import { VersionPane } from "./VersionPane";

const mocks = vi.hoisted(() => ({
  listAppScreenshots: vi.fn(),
  refreshVersions: vi.fn(),
  setVersionFavorite: vi.fn(),
  setVersionNote: vi.fn(),
  send: vi.fn(),
  versions: [] as Version[],
  state: { type: "closed" } as PreviewState,
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
  ipc: { app: { listAppScreenshots: mocks.listAppScreenshots } },
}));

vi.mock("@/hooks/useVersions", () => ({
  useVersions: () => ({
    versions: mocks.versions,
    loading: false,
    error: null,
    refreshVersions: mocks.refreshVersions,
    setVersionFavorite: mocks.setVersionFavorite,
    isSettingVersionFavorite: false,
    setVersionNote: mocks.setVersionNote,
    isSettingVersionNote: false,
  }),
}));

vi.mock("@/hooks/useVersionPreview", () => ({
  useVersionPreview: () => ({
    state: mocks.state,
    projection: projectVersionPreview(mocks.state),
    send: mocks.send,
    sendAndWaitForMutation: vi.fn(),
  }),
}));

const APP_ID = 1;

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

function browsingState(): PreviewState {
  return {
    type: "browsing",
    session: {
      appId: APP_ID,
      originBranch: null,
      targetVersionId: null,
      checkedOutVersionId: null,
      exitIntent: { type: "none" },
      selectedDiffFile: null,
      isDiffVisible: false,
    },
  };
}

function wrapper({ children }: PropsWithChildren) {
  const store = createStore();
  store.set(selectedAppIdAtom, APP_ID);
  return (
    <Provider store={store}>
      <QueryClientProvider client={new QueryClient()}>
        {children}
      </QueryClientProvider>
    </Provider>
  );
}

describe("VersionPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.versions.length = 0;
    mocks.state = { type: "closed" };
    mocks.listAppScreenshots.mockResolvedValue({ screenshots: [] });
    mocks.refreshVersions.mockResolvedValue({ data: mocks.versions });
  });

  it("renders nothing while the window-local pane is closed", () => {
    mocks.versions.push(makeVersion(1));
    render(<VersionPane />, { wrapper });
    expect(screen.queryByText("Version History")).toBeNull();
  });

  it("virtualizes the list and dispatches a semantic checkout intent", async () => {
    mocks.state = browsingState();
    mocks.versions.push(
      ...Array.from({ length: 100 }, (_, index) => makeVersion(index + 1)),
    );
    render(<VersionPane />, { wrapper });

    expect(await screen.findByText("Version History")).toBeDefined();
    expect(
      screen
        .getByTestId("virtualized-version-list")
        .getAttribute("data-total-count"),
    ).toBe("100");
    fireEvent.click(screen.getByTestId("version-row-100"));
    expect(mocks.send).toHaveBeenCalledWith({
      type: "SELECT_VERSION",
      versionId: mocks.versions[0].oid,
    });
  });

  it("keeps restore disabled in recovery-required projection", async () => {
    const browsing = browsingState();
    if (browsing.type !== "browsing") throw new Error("invalid fixture");
    const session = browsing.session;
    mocks.state = {
      type: "recovery-required",
      session: { ...session, originBranch: "feature/origin" },
      error: { message: "return failed" },
    };
    mocks.versions.push(makeVersion(1));
    render(<VersionPane />, { wrapper });
    expect(screen.queryByText("Version History")).toBeNull();
    expect(projectVersionPreview(mocks.state).capabilities.canRestore).toBe(
      false,
    );
  });
});
