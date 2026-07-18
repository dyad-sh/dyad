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
import {
  selectedAppIdAtom,
  selectedVersionIdAtom,
  selectedVersionReturnBranchAtom,
} from "@/atoms/appAtoms";
import type { Version } from "@/ipc/types";
import type {
  VersionPreviewCommands,
  VersionPreviewRuntime,
} from "@/version_preview/controller";
import {
  ensureVersionPreviewController,
  initVersionPreviewRuntime,
  resetVersionPreviewForTests,
} from "@/version_preview/registry";
import { VersionPane } from "./VersionPane";

const {
  listAppScreenshotsMock,
  refreshVersionsMock,
  setVersionFavoriteMock,
  setVersionNoteMock,
  versionsMock,
  versionMutationStateMock,
} = vi.hoisted(() => ({
  listAppScreenshotsMock: vi.fn(),
  refreshVersionsMock: vi.fn(),
  setVersionFavoriteMock: vi.fn(),
  setVersionNoteMock: vi.fn(),
  versionsMock: [] as Version[],
  versionMutationStateMock: { isAnyVersionMutationPending: false },
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
    setVersionFavorite: setVersionFavoriteMock,
    isSettingVersionFavorite: false,
    setVersionNote: setVersionNoteMock,
    isSettingVersionNote: false,
    get isAnyVersionMutationPending() {
      return versionMutationStateMock.isAnyVersionMutationPending;
    },
  }),
}));

const APP_ID = 1;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeFakeRuntime() {
  const calls: Array<{
    type: string;
    input: unknown;
    deferred: Deferred<any>;
  }> = [];
  const track = (type: string) => (input: unknown) => {
    const d = deferred<any>();
    calls.push({ type, input, deferred: d });
    return d.promise;
  };
  const commands = {
    resolveOriginBranch: track("resolve"),
    checkoutVersion: track("checkout"),
    returnToBranch: track("return"),
    restoreVersion: track("restore"),
  } as unknown as VersionPreviewCommands;
  const notifyError = vi.fn();
  const runtime: VersionPreviewRuntime = { commands, notifyError };
  return {
    runtime,
    notifyError,
    calls,
    ofType: (type: string) => calls.filter((call) => call.type === type),
    last: (type: string) => {
      const matching = calls.filter((call) => call.type === type);
      return matching[matching.length - 1];
    },
  };
}

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
  store.set(selectedAppIdAtom, APP_ID);
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

function openPane() {
  act(() => {
    ensureVersionPreviewController(APP_ID).send({
      type: "OPEN",
      appId: APP_ID,
    });
  });
}

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

async function previewFirstVersion(
  fake: ReturnType<typeof makeFakeRuntime>,
  rowTestId = "version-row-1",
  branch = "feature/test",
) {
  fireEvent.click(await screen.findByTestId(rowTestId));
  await act(async () => {
    fake.last("resolve").deferred.resolve({ branch });
  });
  await act(async () => {
    fake.last("checkout").deferred.resolve(undefined);
  });
}

describe("VersionPane", () => {
  let fake: ReturnType<typeof makeFakeRuntime>;

  beforeEach(() => {
    listAppScreenshotsMock.mockReset();
    refreshVersionsMock.mockReset();
    setVersionFavoriteMock.mockReset();
    setVersionNoteMock.mockReset();

    versionsMock.length = 0;
    versionMutationStateMock.isAnyVersionMutationPending = false;
    listAppScreenshotsMock.mockResolvedValue({ screenshots: [] });

    resetVersionPreviewForTests();
    fake = makeFakeRuntime();
    initVersionPreviewRuntime(fake.runtime);
  });

  it("renders nothing until the machine opens the pane", async () => {
    versionsMock.push(makeVersion(1));
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });
    render(<VersionPane />, { wrapper: makeWrapper() });
    expect(screen.queryByText("Version History")).toBeNull();

    openPane();
    expect(await screen.findByText("Version History")).toBeDefined();
  });

  it("renders a large version list through the virtualizer", async () => {
    const versionCount = 1_000;
    versionsMock.push(
      ...Array.from({ length: versionCount }, (_, index) => makeVersion(index)),
    );
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });

    render(<VersionPane />, { wrapper: makeWrapper() });
    openPane();

    await waitFor(() => {
      expect(
        screen
          .getByTestId("virtualized-version-list")
          .getAttribute("data-total-count"),
      ).toBe(String(versionCount));
    });
    expect(screen.getAllByTestId(/^version-row-/)).toHaveLength(20);
  });

  it("sends SELECT_VERSION on row click and resolves through the machine", async () => {
    const version = makeVersion(1);
    versionsMock.push(version);
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });

    render(<VersionPane />, { wrapper: makeWrapper() });
    openPane();

    fireEvent.click(await screen.findByTestId("version-row-1"));
    expect(fake.ofType("resolve")).toHaveLength(1);
    expect(fake.last("resolve").input).toEqual({ appId: APP_ID });
    // While resolving, restore is disabled and no checkout has started.
    const restoreButton = screen.getByRole("button", {
      name: "Restore to this version",
    });
    expect((restoreButton as HTMLButtonElement).disabled).toBe(true);
    expect(restoreButton.getAttribute("title")).toBe(
      "Preparing version preview...",
    );
    expect(fake.ofType("checkout")).toHaveLength(0);

    await act(async () => {
      fake.last("resolve").deferred.resolve({ branch: "feature/test" });
    });
    expect(fake.last("checkout").input).toEqual({
      appId: APP_ID,
      versionId: version.oid,
      hasDbSnapshot: false,
    });
  });

  it("does not preview while another version mutation is pending", async () => {
    versionMutationStateMock.isAnyVersionMutationPending = true;
    versionsMock.push(makeVersion(1));
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });

    render(<VersionPane />, { wrapper: makeWrapper() });
    openPane();

    fireEvent.click(await screen.findByTestId("version-row-1"));
    expect(fake.ofType("resolve")).toHaveLength(0);
    expect(
      (screen.getByRole("button", {
        name: "Restore to this version",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("mirrors the machine's diff selection into the presentation atom", async () => {
    const version = makeVersion(1);
    versionsMock.push(version);
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });
    const store = createStore();

    render(<VersionPane />, { wrapper: makeWrapper(store) });
    openPane();

    await previewFirstVersion(fake);
    expect(store.get(selectedVersionIdAtom)).toBe(version.oid);
    expect(store.get(selectedVersionReturnBranchAtom)).toBe("feature/test");

    fireEvent.click(screen.getByRole("button", { name: "Close version pane" }));
    await waitFor(() => {
      expect(store.get(selectedVersionIdAtom)).toBeNull();
      expect(store.get(selectedVersionReturnBranchAtom)).toBeNull();
    });
  });

  it("returns to the captured branch when the pane closes", async () => {
    const version = makeVersion(1);
    versionsMock.push(version);
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });

    render(<VersionPane />, { wrapper: makeWrapper() });
    openPane();
    await previewFirstVersion(fake);

    fireEvent.click(screen.getByRole("button", { name: "Close version pane" }));
    expect(fake.last("return").input).toEqual({
      appId: APP_ID,
      branch: "feature/test",
    });
    // Pane hides immediately while the return continues in the background.
    expect(screen.queryByText("Version History")).toBeNull();
  });

  it("restores through the machine using the captured origin branch", async () => {
    const version = makeVersion(1);
    versionsMock.push(version);
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });

    render(<VersionPane />, { wrapper: makeWrapper() });
    openPane();
    await previewFirstVersion(fake);

    fireEvent.click(
      screen.getByRole("button", { name: "Restore to this version" }),
    );
    expect(fake.last("restore").input).toEqual({
      appId: APP_ID,
      versionId: version.oid,
      targetBranch: "feature/test",
      hasDbSnapshot: false,
    });
    // Restoring UI while the mutation is pending.
    expect(screen.getByText("Restoring...")).toBeDefined();

    await act(async () => {
      fake.last("restore").deferred.resolve(undefined);
    });
    // Restore success closes the pane with no extra return checkout.
    expect(screen.queryByText("Version History")).toBeNull();
    expect(fake.ofType("return")).toHaveLength(0);
  });

  it("cancels the preview when the branch is unavailable", async () => {
    const version = makeVersion(1);
    versionsMock.push(version);
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });
    const store = createStore();

    render(<VersionPane />, { wrapper: makeWrapper(store) });
    openPane();

    fireEvent.click(await screen.findByTestId("version-row-1"));
    await act(async () => {
      fake.last("resolve").deferred.resolve({ branch: null });
    });

    expect(fake.notifyError).toHaveBeenCalledWith(
      expect.stringContaining("Unable to determine the current Git branch"),
    );
    expect(fake.ofType("checkout")).toHaveLength(0);
    expect(store.get(selectedVersionIdAtom)).toBeNull();
    const restoreButton = screen.getByRole("button", {
      name: "Restore to this version",
    });
    expect((restoreButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the pane visible and row marked while checking out", async () => {
    const version = makeVersion(1);
    versionsMock.push(version);
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });

    render(<VersionPane />, { wrapper: makeWrapper() });
    openPane();

    fireEvent.click(await screen.findByTestId("version-row-1"));
    await act(async () => {
      fake.last("resolve").deferred.resolve({ branch: "feature/test" });
    });

    expect(screen.getByText("Loading...")).toBeDefined();
    // A second click while checking out is ignored by the machine.
    fireEvent.click(screen.getByTestId("version-row-1"));
    expect(fake.ofType("resolve")).toHaveLength(1);
    expect(fake.ofType("checkout")).toHaveLength(1);
  });

  it("refreshes versions when the pane opens", async () => {
    versionsMock.push(makeVersion(1));
    refreshVersionsMock.mockResolvedValue({ data: versionsMock });

    render(<VersionPane />, { wrapper: makeWrapper() });
    expect(refreshVersionsMock).not.toHaveBeenCalled();

    openPane();
    await flush();
    expect(refreshVersionsMock).toHaveBeenCalledOnce();
  });

  it("survives closing while the initial version refresh is pending", async () => {
    versionsMock.push(makeVersion(1));
    let resolveRefresh!: (value: { data: Version[] }) => void;
    refreshVersionsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    render(<VersionPane />, { wrapper: makeWrapper() });
    openPane();
    fireEvent.click(
      await screen.findByRole("button", { name: "Close version pane" }),
    );
    expect(screen.queryByText("Version History")).toBeNull();

    await act(async () => {
      resolveRefresh({ data: versionsMock });
    });
    // Closing before any checkout never issues Git commands.
    expect(fake.ofType("checkout")).toHaveLength(0);
    expect(fake.ofType("return")).toHaveLength(0);
  });
});
