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
  useTranslation: () => ({
    // Mirror i18next's interpolation so a warning that forgets to pass {{path}}
    // fails an assertion instead of silently rendering the raw placeholder.
    t: (key: string, options?: { path?: string }) =>
      options?.path === undefined ? key : `${key}:${options.path}`,
  }),
}));

vi.mock("@/hooks/useVersionPreview", () => ({
  useVersionPreview: () => ({
    // The real hook recombines the machine state with the presentation store on
    // every render, so callers see a fresh object each time. Mirror that: a
    // stable reference here would silently skip effects keyed on the state.
    state: { ...mocks.previewState },
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

vi.mock("./FileTree", () => ({
  FileTree: () => <div data-testid="file-tree" />,
}));
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

// CLOSE moves the machine here while the git return runs. The diff is no
// longer part of the presentation, but the working tree is still detached.
function returningState() {
  return {
    type: "returning",
    session: {
      appId: 1,
      originBranch: "main",
      targetVersionId: "version-1",
      checkedOutVersionId: "version-1",
      selectedDiffFile: { versionId: "version-1", path: "src/selected.ts" },
      isDiffVisible: true,
    },
  };
}

// A failed return leaves the app detached until the recovery notification's
// retry succeeds, and the machine keeps the diff out of the presentation.
function recoveryRequiredState() {
  return {
    ...returningState(),
    type: "recovery-required",
    error: { message: "could not return to main" },
  };
}

// An interrupted restore is the same hazard: still detached, no diff.
function restoreRecoveryRequiredState() {
  return {
    ...returningState(),
    type: "restore-recovery-required",
    error: { message: "restore was interrupted" },
  };
}

// CLOSE hides this window's diff presentation even when another window keeps
// the shared checkout alive, so the machine stays on the previewed commit.
function previewingWithHiddenDiffState() {
  const previewing = previewingState("src/selected.ts");
  return {
    ...previewing,
    session: { ...previewing.session, isDiffVisible: false },
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

// Lets a settled edit continuation run to completion (or to the guard that
// stops it) before the assertions look at what it did.
function flushPendingEdit(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
        "preview.editLatestVersionUnavailable:src/selected.ts",
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
        "preview.editLatestVersionUnavailable:src/selected.ts",
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
        "preview.editLatestVersionMissing:src/only-in-version.ts",
      );
    });
    expect(store.get(selectedFileAtom)).toBeNull();
  });

  it("blocks the file tree while the return to the origin branch is in flight", async () => {
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

    fireEvent.click(editButton());
    // The machine drops the diff as soon as CLOSE is accepted, long before the
    // git return settles; the file tree it would otherwise fall back to still
    // lists the detached checkout's files.
    mocks.previewState = returningState();
    rerenderCodeView();

    expect(screen.getByTestId("returning-to-latest-version")).not.toBeNull();
    expect(screen.queryByTestId("file-editor")).toBeNull();

    finishReturn();

    await waitFor(() => {
      expect(store.get(selectedFileAtom)).toEqual({ path: "src/selected.ts" });
    });
  });

  it("keeps the file tree closed when the return leaves the app detached", async () => {
    const store = createStore();
    mocks.previewState = previewingState("src/selected.ts");
    mocks.versionChanges = [{ path: "src/selected.ts" }];
    mocks.sendPreviewEventAndWait.mockRejectedValue(new Error("return failed"));
    const { rerenderCodeView } = renderCodeView(store, ["src/selected.ts"]);

    fireEvent.click(editButton());

    await waitFor(() => {
      expect(mocks.sendPreviewEventAndWait).toHaveBeenCalled();
    });
    mocks.previewState = recoveryRequiredState();
    rerenderCodeView();

    // Editing anything here would edit - and on save overwrite - the previewed
    // commit's copy, so point at the recovery retry instead.
    expect(
      screen.getByTestId("historical-checkout-not-released"),
    ).not.toBeNull();
    expect(screen.queryByTestId("file-editor")).toBeNull();
    expect(store.get(selectedFileAtom)).toBeNull();
  });

  it("drops a pending edit when the panel is torn down", async () => {
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
    const { unmount } = renderCodeView(store, ["src/selected.ts"]);

    fireEvent.click(editButton());
    // Leaving Code mode unmounts the panel without an app change, so the
    // app-id effect never runs and cannot invalidate the operation.
    unmount();
    finishReturn();
    await flushPendingEdit();

    // The selection is global: committing it here would let a later app render
    // the editor with this app's path.
    expect(store.get(selectedFileAtom)).toBeNull();
    expect(mocks.refreshApp).not.toHaveBeenCalled();
  });

  it("does not blame the next app for the previous app's return", async () => {
    const store = createStore();
    mocks.previewState = previewingState("src/selected.ts");
    mocks.versionChanges = [{ path: "src/selected.ts" }];
    let failReturn: () => void = () => undefined;
    mocks.sendPreviewEventAndWait.mockImplementation(
      () =>
        new Promise<undefined>((_resolve, reject) => {
          failReturn = () => reject(new Error("return failed"));
        }),
    );
    const { rerenderCodeView } = renderCodeView(store, ["src/selected.ts"]);

    fireEvent.click(editButton());
    // The user switches apps while the return is still running.
    mocks.previewState = previewingWithHiddenDiffState();
    mocks.versionChanges = [];
    rerenderCodeView(["src/other-app.ts"], 2);

    // The new app is not returning to anything, so it must not inherit the
    // spinner or the disabled pencil.
    expect(screen.queryByTestId("returning-to-latest-version")).toBeNull();

    failReturn();
    await flushPendingEdit();

    // Nor may the previous app's failure surface as the new app's problem.
    expect(screen.queryByTestId("historical-checkout-not-released")).toBeNull();
  });

  it("keeps the file tree closed when another window keeps the checkout", async () => {
    const store = createStore();
    mocks.previewState = previewingState("src/selected.ts");
    mocks.versionChanges = [{ path: "src/selected.ts" }];
    // CLOSE resolves without running the git return here, so the shared
    // repository stays on the previewed commit.
    mocks.stateAfterClose = previewingState("src/selected.ts");
    const { rerenderCodeView } = renderCodeView(store, ["src/selected.ts"]);

    fireEvent.click(editButton());

    await waitFor(() => {
      expect(mocks.showWarning).toHaveBeenCalled();
    });
    // This window's CLOSE still hid its own diff presentation.
    mocks.previewState = previewingWithHiddenDiffState();
    rerenderCodeView();

    // Nothing failed here, so there is no recovery notification to retry: the
    // checkout is released when the other window closes its preview.
    expect(
      screen.getByTestId("historical-checkout-not-released").textContent,
    ).toBe("preview.historicalCheckoutHeldElsewhere");
    expect(screen.queryByTestId("file-editor")).toBeNull();
  });

  it("stops blaming another window once the checkout is released", async () => {
    const store = createStore();
    mocks.previewState = previewingState("src/selected.ts");
    mocks.versionChanges = [{ path: "src/selected.ts" }];
    mocks.stateAfterClose = previewingState("src/selected.ts");
    const { rerenderCodeView } = renderCodeView(store, ["src/selected.ts"]);

    fireEvent.click(editButton());

    await waitFor(() => {
      expect(mocks.showWarning).toHaveBeenCalled();
    });
    mocks.previewState = previewingWithHiddenDiffState();
    rerenderCodeView();
    expect(
      screen.getByTestId("historical-checkout-not-released"),
    ).not.toBeNull();

    // The other window closes its preview, so the app is back on its branch
    // and nothing is holding it on the previewed commit any more.
    mocks.previewState = { type: "closed" };
    rerenderCodeView();
    expect(screen.queryByTestId("historical-checkout-not-released")).toBeNull();

    // This window now previews a version itself and hides the diff. It owns
    // that checkout, so saying another window is holding one would be a false
    // statement - and it would hide the file tree behind it.
    mocks.previewState = previewingWithHiddenDiffState();
    rerenderCodeView();

    expect(screen.queryByTestId("historical-checkout-not-released")).toBeNull();
    expect(screen.getByTestId("file-tree")).not.toBeNull();
  });

  it("keeps the file tree closed when a checkout starts during the re-list", async () => {
    const store = createStore();
    mocks.previewState = previewingState("src/selected.ts");
    mocks.versionChanges = [{ path: "src/selected.ts" }];
    let finishRefresh: () => void = () => undefined;
    mocks.refreshApp.mockImplementation(
      () =>
        new Promise((resolve) => {
          // Another window starts previewing while the re-list is in flight.
          mocks.stateAfterClose = previewingState("src/selected.ts");
          finishRefresh = () =>
            resolve({
              isError: false,
              data: { id: 1, files: ["src/selected.ts"] },
            });
        }),
    );
    const { rerenderCodeView } = renderCodeView(store, ["src/selected.ts"]);

    fireEvent.click(editButton());

    await waitFor(() => {
      expect(mocks.refreshApp).toHaveBeenCalled();
    });
    // The return did release the checkout, so this window renders the released
    // state before the new one reaches it.
    mocks.previewState = { type: "closed" };
    rerenderCodeView();

    finishRefresh();
    await flushPendingEdit();

    // The edit gave up against a checkout React had not rendered yet, so the
    // file tree must stay closed once that checkout does show up.
    mocks.previewState = previewingWithHiddenDiffState();
    rerenderCodeView();

    expect(
      screen.getByTestId("historical-checkout-not-released").textContent,
    ).toBe("preview.historicalCheckoutHeldElsewhere");
    expect(screen.queryByTestId("file-tree")).toBeNull();
  });

  it("keeps the file tree closed after an interrupted restore", () => {
    const store = createStore();
    mocks.previewState = restoreRecoveryRequiredState();
    renderCodeView(store, ["src/selected.ts"]);

    // This one does have a recovery notification with a retry.
    expect(
      screen.getByTestId("historical-checkout-not-released").textContent,
    ).toBe("preview.historicalCheckoutNotReleased");
    expect(screen.queryByTestId("file-editor")).toBeNull();
  });

  it("does not open the editor when a new checkout starts during the re-list", async () => {
    const store = createStore();
    mocks.previewState = previewingState("src/selected.ts");
    mocks.versionChanges = [{ path: "src/selected.ts" }];
    // The return released the checkout, but another window starts previewing
    // while the re-list is in flight, so the listing describes its checkout.
    mocks.refreshApp.mockImplementation(async () => {
      mocks.stateAfterClose = previewingState("src/selected.ts");
      return { isError: false, data: { id: 1, files: ["src/selected.ts"] } };
    });
    renderCodeView(store, ["src/selected.ts"]);

    fireEvent.click(editButton());

    await waitFor(() => {
      expect(mocks.showWarning).toHaveBeenCalledWith(
        "preview.editLatestVersionUnavailable:src/selected.ts",
      );
    });
    expect(store.get(selectedFileAtom)).toBeNull();
  });

  it("does not edit a staged diff while the app is on a previewed version", () => {
    const store = createStore();
    // Only the version-diff path returns to the origin branch first, so a
    // staged diff would open the detached working tree's copy directly.
    mocks.previewState = previewingWithHiddenDiffState();
    store.set(stagedDiffFileAtom, "src/staged.ts");
    mocks.uncommittedFiles = [{ path: "src/staged.ts", status: "modified" }];
    renderCodeView(store, ["src/staged.ts"]);

    expect(editButton().disabled).toBe(true);
    expect(editButton().dataset.disabledReason).toBe(
      "preview.editDisabledHistoricalCheckout",
    );
    fireEvent.click(editButton());
    expect(store.get(selectedFileAtom)).toBeNull();
  });

  it("explains why the edit action is unavailable", () => {
    const store = createStore();
    mocks.previewState = versionDiffState("src/deleted.ts");
    mocks.versionChanges = [{ path: "src/deleted.ts", type: "delete" }];
    renderCodeView(store, ["src/current.ts"]);

    // A bare disabled pencil says nothing about why it cannot be used.
    expect(editButton().dataset.disabledReason).toBe(
      "preview.editDisabledMissingAtLatest",
    );
    // The tooltip carrying that reason has to hang off a wrapper: a disabled
    // button never emits the pointer events that would open it.
    expect(editButton().parentElement?.dataset.slot).toBe("tooltip-trigger");
  });

  it("allows editing a path the previewed checkout does not have", () => {
    const store = createStore();
    mocks.previewState = previewingState("src/deleted-in-version.ts");
    mocks.versionChanges = [{ path: "src/deleted-in-version.ts" }];
    // The detached working tree cannot list a file the previewed version
    // deleted, but the origin branch may still have it, so the decision belongs
    // to the post-return re-list rather than to this pre-check.
    renderCodeView(store, ["src/current.ts"]);

    expect(editButton().disabled).toBe(false);
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
