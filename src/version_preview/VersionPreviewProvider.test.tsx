import { StrictMode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useVersionPreview } from "@/hooks/useVersionPreview";
import { CLOSED_STATE, type PreviewState } from "./state";
import { VersionPreviewProvider } from "./VersionPreviewProvider";

let remoteState: PreviewState = CLOSED_STATE;
const actorListeners = new Set<() => void>();
const actor = {
  dispatch: vi.fn().mockResolvedValue({ kind: "applied" }),
  getStatus: vi.fn(() => "ready"),
  resync: vi.fn(async () => undefined),
  getView: () => ({
    state: {
      appId: 1,
      revision: 0,
      state: remoteState,
      activeInvocationRef: null,
      lastSettlement: null,
    },
  }),
  subscribe: (listener: () => void) => {
    actorListeners.add(listener);
    return () => actorListeners.delete(listener);
  },
};

const toastError = vi.hoisted(() => vi.fn());
const windowInterest = vi.hoisted(() => ({
  acquire: vi.fn(async () => ({ acquired: true })),
  restoreIfOrphaned: vi.fn(async () => ({ acquired: false })),
  release: vi.fn(
    async (
      _appId: number,
      _operationId: string,
      _exit:
        | { type: "close" }
        | { type: "switch-app"; nextAppId: number | null },
    ) => ({ cleanupStarted: false }),
  ),
  selectionEpoch: vi.fn(() => 0),
  isSelectionEpochCurrent: vi.fn(() => true),
}));
vi.mock("sonner", () => ({
  toast: {
    custom: vi.fn(),
    dismiss: vi.fn(),
    error: toastError,
    success: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock("./window_interest_client", () => ({
  VersionPreviewWindowInterestClient: class {
    acquire = windowInterest.acquire;
    restoreIfOrphaned = windowInterest.restoreIfOrphaned;
    release = windowInterest.release;
    selectionEpoch = windowInterest.selectionEpoch;
    isSelectionEpochCurrent = windowInterest.isSelectionEpochCurrent;
  },
}));

vi.mock("@/distributed_machines/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/distributed_machines/react")>()),
  useRemoteMachineClient: () => ({ actor: () => actor }),
  useDistributedMachine: () => ({
    state: actor.getView().state,
    projection: actor.getView().state,
    connection: "ready",
    dispatch: actor.dispatch,
  }),
}));

vi.mock("@/hooks/useSelectChat", () => ({
  useSelectChat: () => ({ selectChat: vi.fn() }),
}));

function Probe() {
  const { state, send, isPaneVisible } = useVersionPreview(1);
  return (
    <button
      data-testid="probe"
      data-state={state.type}
      data-visible={isPaneVisible}
      onClick={() => send({ type: "OPEN", appId: 1 })}
    >
      Open
    </button>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("VersionPreviewProvider", () => {
  beforeEach(() => {
    actor.dispatch.mockReset().mockResolvedValue({ kind: "applied" });
    actor.getStatus.mockReturnValue("ready");
    actor.resync.mockClear();
    actorListeners.clear();
    remoteState = CLOSED_STATE;
    toastError.mockClear();
    windowInterest.acquire.mockReset().mockResolvedValue({ acquired: true });
    windowInterest.restoreIfOrphaned
      .mockReset()
      .mockResolvedValue({ acquired: false });
    windowInterest.release
      .mockReset()
      .mockResolvedValue({ cleanupStarted: false });
    windowInterest.selectionEpoch.mockReset().mockReturnValue(0);
    windowInterest.isSelectionEpochCurrent.mockReset().mockReturnValue(true);
    getDefaultStore().set(selectedAppIdAtom, null);
  });

  it("keeps window-local presentation live across StrictMode replay", async () => {
    const queryClient = new QueryClient();
    render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <VersionPreviewProvider>
            <Probe />
          </VersionPreviewProvider>
        </QueryClientProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId("probe")).toBeTruthy());
    fireEvent.click(screen.getByTestId("probe"));
    await waitFor(() =>
      expect(screen.getByTestId("probe").getAttribute("data-state")).toBe(
        "browsing",
      ),
    );
  });

  it("does not commit a local version selection when main rejects it", async () => {
    actor.dispatch.mockResolvedValueOnce({
      kind: "ignored",
      reason: "invalid-transition",
    });
    const queryClient = new QueryClient();

    function SelectionProbe() {
      const { state, send } = useVersionPreview(1);
      return (
        <button
          data-testid="selection-probe"
          data-state={state.type}
          onClick={() =>
            send({ type: "SELECT_VERSION", versionId: "rejected-version" })
          }
        >
          Select
        </button>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <VersionPreviewProvider>
          <SelectionProbe />
        </VersionPreviewProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId("selection-probe"));
    await waitFor(() => expect(actor.dispatch).toHaveBeenCalled());
    await waitFor(() =>
      expect(windowInterest.release).toHaveBeenCalledWith(
        1,
        expect.stringMatching(/^version-preview:/),
        { type: "close" },
      ),
    );
    expect(
      screen.getByTestId("selection-probe").getAttribute("data-state"),
    ).toBe("closed");
  });

  it("releases app-switch cleanup through the main interest coordinator", async () => {
    getDefaultStore().set(selectedAppIdAtom, 1);
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <VersionPreviewProvider>
          <Probe />
        </VersionPreviewProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId("probe"));
    await waitFor(() => expect(windowInterest.acquire).toHaveBeenCalledWith(1));

    act(() => getDefaultStore().set(selectedAppIdAtom, 2));

    await waitFor(() =>
      expect(windowInterest.release).toHaveBeenCalledWith(
        1,
        expect.stringMatching(/^version-preview:/),
        { type: "switch-app", nextAppId: 2 },
      ),
    );
    expect(actor.dispatch).not.toHaveBeenCalled();
  });

  it("keeps the old presentation visible until an app-switch release retry is accepted", async () => {
    getDefaultStore().set(selectedAppIdAtom, 1);
    const accepted = deferred<{ cleanupStarted: false }>();
    windowInterest.release
      .mockRejectedValueOnce(new Error("transport unavailable"))
      .mockReturnValueOnce(accepted.promise);
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <VersionPreviewProvider>
          <Probe />
        </VersionPreviewProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId("probe"));
    await waitFor(() =>
      expect(screen.getByTestId("probe").getAttribute("data-state")).toBe(
        "browsing",
      ),
    );

    act(() => getDefaultStore().set(selectedAppIdAtom, 2));
    await waitFor(() =>
      expect(windowInterest.release).toHaveBeenCalledTimes(2),
    );
    expect(actor.resync).toHaveBeenCalled();
    expect(windowInterest.release.mock.calls[0]?.[1]).toBe(
      windowInterest.release.mock.calls[1]?.[1],
    );
    expect(screen.getByTestId("probe").getAttribute("data-state")).toBe(
      "browsing",
    );

    accepted.resolve({ cleanupStarted: false });
    await waitFor(() =>
      expect(screen.getByTestId("probe").getAttribute("data-state")).toBe(
        "closed",
      ),
    );
  });

  it("releases retained interest when navigating with local presentation hidden", async () => {
    getDefaultStore().set(selectedAppIdAtom, 1);
    remoteState = {
      type: "previewing",
      session: {
        appId: 1,
        originBranch: "main",
        targetVersionId: "abc123",
        checkedOutVersionId: "abc123",
        exitIntent: { type: "none" },
        selectedDiffFile: null,
        isDiffVisible: false,
      },
    };
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <VersionPreviewProvider>
          <div>content</div>
        </VersionPreviewProvider>
      </QueryClientProvider>,
    );

    act(() => getDefaultStore().set(selectedAppIdAtom, 2));

    await waitFor(() => expect(windowInterest.release).toHaveBeenCalled());
    expect(actor.dispatch).not.toHaveBeenCalled();
  });

  it("restores a reloaded pane when its historical checkout is orphaned", async () => {
    getDefaultStore().set(selectedAppIdAtom, 1);
    remoteState = {
      type: "previewing",
      session: {
        appId: 1,
        originBranch: "main",
        targetVersionId: "abc123",
        checkedOutVersionId: "abc123",
        exitIntent: { type: "none" },
        selectedDiffFile: null,
        isDiffVisible: false,
      },
    };
    windowInterest.restoreIfOrphaned.mockResolvedValueOnce({ acquired: true });
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <VersionPreviewProvider>
          <Probe />
        </VersionPreviewProvider>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(windowInterest.restoreIfOrphaned).toHaveBeenCalledWith(1),
    );
    await waitFor(() =>
      expect(screen.getByTestId("probe").getAttribute("data-visible")).toBe(
        "true",
      ),
    );
  });

  it("keeps a reloaded pane hidden when another window owns the checkout", async () => {
    getDefaultStore().set(selectedAppIdAtom, 1);
    remoteState = {
      type: "previewing",
      session: {
        appId: 1,
        originBranch: "main",
        targetVersionId: "abc123",
        checkedOutVersionId: "abc123",
        exitIntent: { type: "none" },
        selectedDiffFile: null,
        isDiffVisible: false,
      },
    };
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <VersionPreviewProvider>
          <Probe />
        </VersionPreviewProvider>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(windowInterest.restoreIfOrphaned).toHaveBeenCalledWith(1),
    );
    expect(screen.getByTestId("probe").getAttribute("data-visible")).toBe(
      "false",
    );
  });

  it("retries orphan restoration after the previous owner disappears", async () => {
    getDefaultStore().set(selectedAppIdAtom, 1);
    remoteState = {
      type: "previewing",
      session: {
        appId: 1,
        originBranch: "main",
        targetVersionId: "abc123",
        checkedOutVersionId: "abc123",
        exitIntent: { type: "none" },
        selectedDiffFile: null,
        isDiffVisible: false,
      },
    };
    windowInterest.restoreIfOrphaned
      .mockResolvedValueOnce({ acquired: false })
      .mockResolvedValueOnce({ acquired: true });
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <VersionPreviewProvider>
          <Probe />
        </VersionPreviewProvider>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(windowInterest.restoreIfOrphaned).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(screen.getByTestId("probe").getAttribute("data-visible")).toBe(
        "true",
      ),
    );
  });

  it("closes local presentation after a restore settles closed", async () => {
    getDefaultStore().set(selectedAppIdAtom, 1);
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <VersionPreviewProvider>
          <Probe />
        </VersionPreviewProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId("probe"));
    await waitFor(() =>
      expect(screen.getByTestId("probe").getAttribute("data-visible")).toBe(
        "true",
      ),
    );

    act(() => {
      remoteState = {
        type: "restoring",
        fallback: "browsing",
        session: {
          appId: 1,
          originBranch: "main",
          targetVersionId: "abc123",
          checkedOutVersionId: null,
          exitIntent: { type: "none" },
          selectedDiffFile: null,
          isDiffVisible: false,
        },
      };
      actorListeners.forEach((listener) => listener());
    });
    act(() => {
      remoteState = CLOSED_STATE;
      actorListeners.forEach((listener) => listener());
    });

    await waitFor(() =>
      expect(screen.getByTestId("probe").getAttribute("data-visible")).toBe(
        "false",
      ),
    );
  });

  it("resyncs a rejected recovery retry and surfaces terminal rejection", async () => {
    getDefaultStore().set(selectedAppIdAtom, 1);
    remoteState = {
      type: "recovery-required",
      session: {
        appId: 1,
        originBranch: "main",
        targetVersionId: "abc123",
        checkedOutVersionId: "abc123",
        exitIntent: { type: "none" },
        selectedDiffFile: null,
        isDiffVisible: false,
      },
      error: { message: "Return failed" },
    };
    actor.dispatch
      .mockResolvedValueOnce({
        kind: "rejected",
        reason: "revision-conflict",
      })
      .mockResolvedValueOnce({
        kind: "ignored",
        reason: "invalid-transition",
      });
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <VersionPreviewProvider>
          <div>content</div>
        </VersionPreviewProvider>
      </QueryClientProvider>,
    );

    const recoveryToast = toastError.mock.calls.find(
      ([message]) =>
        message ===
        "Unable to return to the branch that was active before previewing this version.",
    );
    expect(recoveryToast).toBeDefined();
    act(() => recoveryToast?.[1]?.action?.onClick());

    await waitFor(() => expect(actor.dispatch).toHaveBeenCalledTimes(2));
    expect(actor.resync).toHaveBeenCalled();
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Version recovery could not be started. Please try again.",
      ),
    );
  });

  it("serializes rapid selections so an accepted version stays visible", async () => {
    const first = deferred<{ kind: "applied" }>();
    actor.dispatch.mockReturnValueOnce(first.promise).mockResolvedValueOnce({
      kind: "ignored",
      reason: "invalid-transition",
    });
    const queryClient = new QueryClient();

    function RapidSelectionProbe() {
      const { state, send } = useVersionPreview(1);
      return (
        <div
          data-testid="rapid-selection"
          data-version={
            state.type === "viewing-diff"
              ? state.session.targetVersionId
              : "none"
          }
        >
          <button
            onClick={() => send({ type: "SELECT_VERSION", versionId: "a" })}
          >
            A
          </button>
          <button
            onClick={() => send({ type: "SELECT_VERSION", versionId: "b" })}
          >
            B
          </button>
        </div>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <VersionPreviewProvider>
          <RapidSelectionProbe />
        </VersionPreviewProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText("A"));
    fireEvent.click(screen.getByText("B"));
    await waitFor(() => expect(actor.dispatch).toHaveBeenCalledTimes(1));

    first.resolve({ kind: "applied" });
    await waitFor(() => expect(actor.dispatch).toHaveBeenCalledTimes(2));
    expect(
      screen.getByTestId("rapid-selection").getAttribute("data-version"),
    ).toBe("a");
  });

  it("cancels a queued selection when the pane closes", async () => {
    const resync = deferred<undefined>();
    actor.resync.mockReturnValueOnce(resync.promise);
    windowInterest.release.mockImplementationOnce(async () => {
      windowInterest.isSelectionEpochCurrent.mockReturnValue(false);
      return { cleanupStarted: false };
    });
    const queryClient = new QueryClient();

    function SelectionCloseProbe() {
      const { send } = useVersionPreview(1);
      return (
        <>
          <button
            onClick={() => send({ type: "SELECT_VERSION", versionId: "a" })}
          >
            Select
          </button>
          <button onClick={() => send({ type: "CLOSE" })}>Close</button>
        </>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <VersionPreviewProvider>
          <SelectionCloseProbe />
        </VersionPreviewProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText("Select"));
    await waitFor(() => expect(actor.resync).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("Close"));
    await waitFor(() => expect(windowInterest.release).toHaveBeenCalled());

    await act(async () => {
      resync.resolve(undefined);
      await resync.promise;
      await Promise.resolve();
    });
    expect(actor.dispatch).not.toHaveBeenCalled();
    expect(windowInterest.acquire).not.toHaveBeenCalled();
  });

  it("keeps the pane visible until main accepts its window release", async () => {
    const accepted = deferred<{ cleanupStarted: false }>();
    windowInterest.release.mockReturnValueOnce(accepted.promise);
    const queryClient = new QueryClient();

    function CloseProbe() {
      const { state, send } = useVersionPreview(1);
      return (
        <div data-testid="close-probe" data-state={state.type}>
          <button onClick={() => send({ type: "OPEN", appId: 1 })}>Open</button>
          <button onClick={() => send({ type: "CLOSE" })}>Close</button>
        </div>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <VersionPreviewProvider>
          <CloseProbe />
        </VersionPreviewProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText("Open"));
    await waitFor(() =>
      expect(screen.getByTestId("close-probe").getAttribute("data-state")).toBe(
        "browsing",
      ),
    );

    fireEvent.click(screen.getByText("Close"));
    await waitFor(() => expect(windowInterest.release).toHaveBeenCalled());
    expect(screen.getByTestId("close-probe").getAttribute("data-state")).toBe(
      "browsing",
    );

    accepted.resolve({ cleanupStarted: false });
    await waitFor(() =>
      expect(screen.getByTestId("close-probe").getAttribute("data-state")).toBe(
        "closed",
      ),
    );
  });
});
