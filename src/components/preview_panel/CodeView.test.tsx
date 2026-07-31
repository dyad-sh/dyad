import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectedFileAtom, stagedDiffFileAtom } from "@/atoms/viewAtoms";
import { queryKeys } from "@/lib/queryKeys";
import { CodeView } from "./CodeView";

const mocks = vi.hoisted(() => ({
  previewState: { type: "closed" } as any,
  sendPreviewEvent: vi.fn(),
  sendPreviewEventAndWait: vi.fn(async () => undefined),
  versionChanges: [] as Array<Record<string, unknown>>,
  uncommittedFiles: [] as Array<Record<string, unknown>>,
  // What the app lists after returning to the origin branch, i.e. the branch's
  // latest files rather than the previewed checkout's.
  originBranchFiles: [] as string[],
  // What the machine reports once the CLOSE promise settles, which is not
  // necessarily "returned" - another window may still hold the checkout.
  stateAfterClose: { type: "closed" } as any,
  refreshApp: vi.fn(),
  showWarning: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/useVersionPreview", () => ({
  useVersionPreview: () => ({
    state: mocks.previewState,
    send: mocks.sendPreviewEvent,
    sendAndWaitForMutation: mocks.sendPreviewEventAndWait,
    getState: () => mocks.stateAfterClose,
  }),
}));

vi.mock("@/hooks/useVersionChanges", () => ({
  useVersionChanges: () => ({ changes: mocks.versionChanges }),
}));

vi.mock("@/hooks/useUncommittedFiles", () => ({
  useUncommittedFiles: () => ({
    uncommittedFiles: mocks.uncommittedFiles,
    hasUncommittedFiles: mocks.uncommittedFiles.length > 0,
  }),
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({ refreshApp: mocks.refreshApp }),
}));

vi.mock("@/lib/toast", () => ({
  showWarning: mocks.showWarning,
}));

vi.mock("./VersionDiffView", () => ({
  VersionDiffView: () => <div data-testid="version-diff-view" />,
}));

vi.mock("./StagedDiffView", () => ({
  StagedDiffView: () => <div data-testid="staged-diff-view" />,
}));

vi.mock("./FileTree", () => ({ FileTree: () => <div /> }));
vi.mock("./FileEditor", () => ({
  FileEditor: ({ filePath }: { filePath: string }) => (
    <div data-testid="file-editor">{filePath}</div>
  ),
}));
vi.mock("./CommitMenu", () => ({ CommitMenu: () => null }));
vi.mock("react-resizable-panels", () => ({
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PanelResizeHandle: () => <div />,
}));

function versionDiffState(selectedPath: string) {
  return {
    type: "viewing-diff",
    session: {
      appId: 1,
      targetVersionId: "version-1",
      checkedOutVersionId: null,
      selectedDiffFile: { versionId: "version-1", path: selectedPath },
      isDiffVisible: true,
    },
  };
}

// The Version pane checks the app out at the previewed commit, so the session
// owns a historical (detached HEAD) checkout while the diff is displayed.
function previewingState(selectedPath: string) {
  return {
    type: "previewing",
    session: {
      appId: 1,
      originBranch: "main",
      targetVersionId: "version-1",
      checkedOutVersionId: "version-1",
      selectedDiffFile: { versionId: "version-1", path: selectedPath },
      isDiffVisible: true,
    },
  };
}

function renderCodeView(
  store: ReturnType<typeof createStore>,
  files: string[],
  queryClient = new QueryClient(),
) {
  const view = (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <CodeView loading={false} app={{ id: 1, files }} />
      </Provider>
    </QueryClientProvider>
  );
  const rendered = render(view);
  return {
    ...rendered,
    queryClient,
    rerenderCodeView: (nextFiles: string[] = files, appId = 1) =>
      rendered.rerender(
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>
            <CodeView loading={false} app={{ id: appId, files: nextFiles }} />
          </Provider>
        </QueryClientProvider>,
      ),
  };
}

function editButton(): HTMLButtonElement {
  return screen.getByTestId("edit-latest-version-button") as HTMLButtonElement;
}

describe("CodeView diff editing", () => {
  beforeEach(() => {
    mocks.previewState = { type: "closed" };
    mocks.sendPreviewEvent.mockReset();
    mocks.sendPreviewEventAndWait.mockReset();
    mocks.sendPreviewEventAndWait.mockResolvedValue(undefined);
    mocks.versionChanges = [];
    mocks.uncommittedFiles = [];
    mocks.originBranchFiles = ["src/selected.ts"];
    mocks.stateAfterClose = { type: "closed" };
    mocks.refreshApp.mockReset();
    mocks.refreshApp.mockImplementation(async () => ({
      isError: false,
      data: { id: 1, files: mocks.originBranchFiles },
    }));
    mocks.showWarning.mockReset();
  });

  it("opens the displayed version-diff path in the regular editor", () => {
    const store = createStore();
    mocks.previewState = versionDiffState("src/selected.ts");
    mocks.versionChanges = [
      { path: "src/first.ts" },
      { path: "src/selected.ts" },
    ];
    const { rerenderCodeView } = renderCodeView(store, ["src/selected.ts"]);

    fireEvent.click(screen.getByTestId("edit-latest-version-button"));

    expect(store.get(selectedFileAtom)).toEqual({ path: "src/selected.ts" });
    expect(mocks.sendPreviewEvent).toHaveBeenCalledWith({
      type: "CLOSE_VERSION_DIFF",
    });
    // No historical checkout to leave, so no Git mutation is needed.
    expect(mocks.sendPreviewEventAndWait).not.toHaveBeenCalled();
    mocks.previewState = { type: "closed" };
    rerenderCodeView();
    expect(screen.getByTestId("file-editor").textContent).toBe(
      "src/selected.ts",
    );
  });

  it("returns to the origin branch before editing a previewed version", async () => {
    const store = createStore();
    mocks.previewState = previewingState("src/selected.ts");
    mocks.versionChanges = [{ path: "src/selected.ts" }];
    let finishReturn: () => void = () => undefined;
    mocks.sendPreviewEventAndWait.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          finishReturn = () => resolve(undefined);
        }),
    );
    const queryClient = new QueryClient();
    const staleContentKey = queryKeys.appFiles.content({
      appId: 1,
      filePath: "src/selected.ts",
    });
    // Content read while detached describes the previewed commit, not the branch.
    queryClient.setQueryData(staleContentKey, "historical contents");
    renderCodeView(store, ["src/selected.ts"], queryClient);

    fireEvent.click(screen.getByTestId("edit-latest-version-button"));

    expect(mocks.sendPreviewEventAndWait).toHaveBeenCalledWith({
      type: "CLOSE",
    });
    expect(mocks.sendPreviewEvent).not.toHaveBeenCalled();
    // The editor must not open until the app is back on its origin branch.
    expect(store.get(selectedFileAtom)).toBeNull();

    finishReturn();

    await waitFor(() => {
      expect(store.get(selectedFileAtom)).toEqual({ path: "src/selected.ts" });
    });
    expect(queryClient.getQueryData(staleContentKey)).toBeUndefined();
  });

  it("hides the previously open file while the return is in flight", async () => {
    const store = createStore();
    // A file opened before the version diff would otherwise keep rendering -
    // showing the detached working tree's copy - the moment CLOSE hides the
    // diff, which happens before the git return settles.
    store.set(selectedFileAtom, { path: "src/already-open.ts" });
    mocks.previewState = previewingState("src/selected.ts");
    mocks.versionChanges = [{ path: "src/selected.ts" }];
    let finishReturn: () => void = () => undefined;
    mocks.sendPreviewEventAndWait.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          finishReturn = () => resolve(undefined);
        }),
    );
    renderCodeView(store, ["src/selected.ts"]);

    fireEvent.click(screen.getByTestId("edit-latest-version-button"));

    expect(store.get(selectedFileAtom)).toBeNull();

    finishReturn();

    await waitFor(() => {
      expect(store.get(selectedFileAtom)).toEqual({ path: "src/selected.ts" });
    });
  });

  it("does not edit when CLOSE settled without releasing the checkout", async () => {
    const store = createStore();
    mocks.previewState = previewingState("src/selected.ts");
    mocks.versionChanges = [{ path: "src/selected.ts" }];
    // CLOSE resolves without running the git return when another window still
    // holds the preview, leaving the app on the detached checkout.
    mocks.stateAfterClose = previewingState("src/selected.ts");
    renderCodeView(store, ["src/selected.ts"]);

    fireEvent.click(screen.getByTestId("edit-latest-version-button"));

    await waitFor(() => {
      expect(mocks.showWarning).toHaveBeenCalledWith(
        "preview.editLatestVersionUnavailable",
      );
    });
    expect(store.get(selectedFileAtom)).toBeNull();
    expect(mocks.refreshApp).not.toHaveBeenCalled();
  });

  it("does not edit when the post-return file listing fails", async () => {
    const store = createStore();
    mocks.previewState = previewingState("src/selected.ts");
    mocks.versionChanges = [{ path: "src/selected.ts" }];
    // refetch() resolves with the last-good (detached) listing on failure, so
    // the path being present there proves nothing about the origin branch.
    mocks.refreshApp.mockResolvedValue({
      isError: true,
      data: { id: 1, files: ["src/selected.ts"] },
    });
    renderCodeView(store, ["src/selected.ts"]);

    fireEvent.click(screen.getByTestId("edit-latest-version-button"));

    await waitFor(() => {
      expect(mocks.showWarning).toHaveBeenCalledWith(
        "preview.editLatestVersionUnavailable",
      );
    });
    expect(store.get(selectedFileAtom)).toBeNull();
  });

  it("drops the edit when another app is displayed before the return finishes", async () => {
    const store = createStore();
    mocks.previewState = previewingState("src/selected.ts");
    mocks.versionChanges = [{ path: "src/selected.ts" }];
    let finishReturn: () => void = () => undefined;
    mocks.sendPreviewEventAndWait.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          finishReturn = () => resolve(undefined);
        }),
    );
    const { rerenderCodeView } = renderCodeView(store, ["src/selected.ts"]);

    fireEvent.click(screen.getByTestId("edit-latest-version-button"));
    rerenderCodeView(["src/other-app.ts"], 2);
    finishReturn();

    await waitFor(() => {
      expect(mocks.sendPreviewEventAndWait).toHaveBeenCalled();
    });
    // The other app's editor must not inherit this app's file selection.
    expect(store.get(selectedFileAtom)).toBeNull();
    expect(mocks.refreshApp).not.toHaveBeenCalled();
  });

  it("clears a stale staged selection when editing a version diff", () => {
    const store = createStore();
    // Left over from a staged diff the user opened before the version diff.
    store.set(stagedDiffFileAtom, "src/staged.ts");
    mocks.previewState = versionDiffState("src/selected.ts");
    mocks.versionChanges = [{ path: "src/selected.ts" }];
    const { rerenderCodeView } = renderCodeView(store, ["src/selected.ts"]);

    fireEvent.click(screen.getByTestId("edit-latest-version-button"));

    expect(store.get(stagedDiffFileAtom)).toBeNull();
    mocks.previewState = { type: "closed" };
    rerenderCodeView();
    // Staged-diff mode would otherwise take over once the version diff closed.
    expect(screen.queryByTestId("staged-diff-view")).toBeNull();
    expect(screen.getByTestId("file-editor").textContent).toBe(
      "src/selected.ts",
    );
  });

  it("does not open a file that the origin branch no longer has", async () => {
    const store = createStore();
    mocks.previewState = previewingState("src/only-in-version.ts");
    mocks.versionChanges = [{ path: "src/only-in-version.ts" }];
    // The detached checkout on disk still lists the previewed commit's file...
    renderCodeView(store, ["src/only-in-version.ts"]);
    // ...but the branch deleted it, so the post-return listing omits it.
    mocks.originBranchFiles = ["src/current.ts"];

    fireEvent.click(screen.getByTestId("edit-latest-version-button"));

    await waitFor(() => {
      expect(mocks.showWarning).toHaveBeenCalledWith(
        "preview.editLatestVersionMissing",
      );
    });
    expect(store.get(selectedFileAtom)).toBeNull();
  });

  it("keeps the diff open when returning to the origin branch fails", async () => {
    const store = createStore();
    mocks.previewState = previewingState("src/selected.ts");
    mocks.versionChanges = [{ path: "src/selected.ts" }];
    mocks.sendPreviewEventAndWait.mockRejectedValue(new Error("return failed"));
    renderCodeView(store, ["src/selected.ts"]);

    fireEvent.click(screen.getByTestId("edit-latest-version-button"));

    await waitFor(() => {
      expect(editButton().disabled).toBe(false);
    });
    expect(store.get(selectedFileAtom)).toBeNull();
    expect(screen.queryByTestId("version-diff-view")).not.toBeNull();
  });

  it("disables editing while a version Git mutation is in flight", () => {
    const store = createStore();
    const previewing = previewingState("src/selected.ts");
    mocks.previewState = { ...previewing, type: "checking-out" };
    mocks.versionChanges = [{ path: "src/selected.ts" }];
    renderCodeView(store, ["src/selected.ts"]);

    expect(editButton().disabled).toBe(true);
  });

  it("uses the staged view fallback and clears staged diff mode", () => {
    const store = createStore();
    store.set(stagedDiffFileAtom, "src/no-longer-staged.ts");
    mocks.uncommittedFiles = [{ path: "src/fallback.ts", status: "modified" }];
    renderCodeView(store, ["src/fallback.ts"]);

    fireEvent.click(screen.getByTestId("edit-latest-version-button"));

    expect(store.get(selectedFileAtom)).toEqual({ path: "src/fallback.ts" });
    expect(store.get(stagedDiffFileAtom)).toBeNull();
    expect(screen.getByTestId("file-editor").textContent).toBe(
      "src/fallback.ts",
    );
  });

  it("disables editing when the displayed diff path is missing at HEAD", () => {
    const store = createStore();
    mocks.previewState = versionDiffState("src/deleted.ts");
    mocks.versionChanges = [{ path: "src/deleted.ts", type: "delete" }];
    renderCodeView(store, ["src/current.ts"]);

    expect(editButton().disabled).toBe(true);
    expect(store.get(selectedFileAtom)).toBeNull();
  });
});
