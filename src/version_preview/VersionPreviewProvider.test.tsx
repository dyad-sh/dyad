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
import { CLOSED_STATE } from "./state";
import { VersionPreviewProvider } from "./VersionPreviewProvider";

const actor = {
  dispatch: vi.fn().mockResolvedValue({ kind: "applied" }),
  getStatus: vi.fn(() => "ready"),
  resync: vi.fn(async () => undefined),
  getView: () => ({
    state: {
      appId: 1,
      revision: 0,
      state: CLOSED_STATE,
      activeInvocationRef: null,
      lastSettlement: null,
    },
  }),
  subscribe: () => () => undefined,
};

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
  const { state, send } = useVersionPreview(1);
  return (
    <button
      data-testid="probe"
      data-state={state.type}
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
    expect(screen.getByTestId("probe").getAttribute("data-state")).toBe(
      "browsing",
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
    expect(
      screen.getByTestId("selection-probe").getAttribute("data-state"),
    ).toBe("closed");
  });

  it("resyncs and retries stale app-switch cleanup", async () => {
    getDefaultStore().set(selectedAppIdAtom, 1);
    actor.dispatch
      .mockResolvedValueOnce({
        kind: "rejected",
        reason: "revision-conflict",
      })
      .mockResolvedValueOnce({ kind: "applied" });
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <VersionPreviewProvider>
          <div>content</div>
        </VersionPreviewProvider>
      </QueryClientProvider>,
    );

    act(() => getDefaultStore().set(selectedAppIdAtom, 2));

    await waitFor(() => expect(actor.dispatch).toHaveBeenCalledTimes(2));
    expect(actor.resync).toHaveBeenCalled();
    expect(actor.dispatch.mock.calls[0]?.[0]).toEqual(
      actor.dispatch.mock.calls[1]?.[0],
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

  it("keeps the pane visible until stale close cleanup is accepted", async () => {
    const accepted = deferred<{ kind: "applied" }>();
    actor.dispatch
      .mockResolvedValueOnce({
        kind: "rejected",
        reason: "revision-conflict",
      })
      .mockReturnValueOnce(accepted.promise);
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
    expect(screen.getByTestId("close-probe").getAttribute("data-state")).toBe(
      "browsing",
    );

    fireEvent.click(screen.getByText("Close"));
    await waitFor(() => expect(actor.dispatch).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("close-probe").getAttribute("data-state")).toBe(
      "browsing",
    );

    accepted.resolve({ kind: "applied" });
    await waitFor(() =>
      expect(screen.getByTestId("close-probe").getAttribute("data-state")).toBe(
        "closed",
      ),
    );
  });
});
