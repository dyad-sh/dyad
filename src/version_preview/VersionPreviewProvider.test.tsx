import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { useVersionPreview } from "@/hooks/useVersionPreview";
import type { VersionPreviewRuntime } from "./controller";
import { VersionPreviewManager } from "./manager";
import { VersionPreviewProvider } from "./VersionPreviewProvider";

function runtime(): VersionPreviewRuntime {
  return {
    notifyError: vi.fn(),
    notifyRecovery: vi.fn(),
    dismissRecovery: vi.fn(),
    commands: {
      resolveOriginBranch: vi.fn().mockResolvedValue({ branch: "main" }),
      checkoutVersion: vi.fn().mockResolvedValue(undefined),
      returnToBranch: vi.fn().mockResolvedValue(undefined),
      switchBranch: vi.fn().mockResolvedValue(undefined),
      restoreVersion: vi.fn().mockResolvedValue(undefined),
      restoreToMessage: vi
        .fn()
        .mockResolvedValue({ repositoryOutcome: "target-applied" }),
    },
  };
}

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
  it("keeps its manager live across StrictMode effect replay", async () => {
    const manager = new VersionPreviewManager(runtime(), createStore());
    render(
      <StrictMode>
        <VersionPreviewProvider manager={manager}>
          <Probe />
        </VersionPreviewProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId("probe")).toBeTruthy());
    fireEvent.click(screen.getByTestId("probe"));
    expect(screen.getByTestId("probe").getAttribute("data-state")).toBe(
      "browsing",
    );
  });
});
