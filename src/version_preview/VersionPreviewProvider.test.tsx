import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVersionPreview } from "@/hooks/useVersionPreview";
import { CLOSED_STATE } from "./state";
import { VersionPreviewProvider } from "./VersionPreviewProvider";

const actor = {
  dispatch: vi.fn().mockResolvedValue({ kind: "applied" }),
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

describe("VersionPreviewProvider", () => {
  beforeEach(() => {
    actor.dispatch.mockReset().mockResolvedValue({ kind: "applied" });
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
});
