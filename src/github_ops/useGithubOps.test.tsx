import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { INITIAL_GITHUB_OPS_STATE } from "./state";
import { projectGithubOps } from "./projection";
import { useGithubOps } from "./useGithubOps";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  showError: vi.fn(),
  connection: "connecting" as "connecting" | "ready" | "disconnected",
  remote: undefined as any,
}));

vi.mock("@/distributed_machines/react", () => ({
  useDistributedMachine: () => mocks.remote,
}));

vi.mock("@/lib/toast", () => ({ showError: mocks.showError }));

describe("useGithubOps remote readiness", () => {
  beforeEach(() => {
    mocks.dispatch.mockReset();
    mocks.showError.mockReset();
    mocks.connection = "connecting";
    mocks.remote = {
      state: {
        appId: 7,
        revision: 0,
        state: INITIAL_GITHUB_OPS_STATE,
        activeInvocationRef: null,
        conflictResolutionClaimed: false,
      },
      projection: projectGithubOps(INITIAL_GITHUB_OPS_STATE),
      connection: mocks.connection,
      dispatch: mocks.dispatch,
    };
  });

  it("disables actor-backed capabilities and defers reconcile until ready", async () => {
    mocks.dispatch.mockResolvedValue({ kind: "applied", messageId: "m1" });
    const { result, rerender } = renderHook(() => useGithubOps(7));

    expect(result.current.projection.capabilities.canSync).toBe(false);
    expect(mocks.dispatch).not.toHaveBeenCalled();

    mocks.connection = "ready";
    mocks.remote = { ...mocks.remote, connection: "ready" };
    rerender();
    await vi.waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: "RECONCILE_REQUESTED",
      }),
    );
  });

  it("consumes transport rejections from ordinary UI sends", async () => {
    mocks.connection = "ready";
    mocks.remote = { ...mocks.remote, connection: "ready" };
    mocks.dispatch.mockRejectedValue(new Error("disconnected"));
    const { result } = renderHook(() =>
      useGithubOps(7, { reconcileOnMount: false }),
    );

    act(() => {
      result.current.send({
        type: "OP_REQUESTED",
        op: { type: "push", mode: "normal" },
      });
    });

    await vi.waitFor(() => expect(mocks.showError).toHaveBeenCalledOnce());
  });

  it("returns no receipt and reports conflict-claim dispatch failures", async () => {
    mocks.connection = "ready";
    mocks.remote = { ...mocks.remote, connection: "ready" };
    mocks.dispatch.mockRejectedValue(new Error("disconnected"));
    const { result } = renderHook(() =>
      useGithubOps(7, { reconcileOnMount: false }),
    );

    let receipt: unknown;
    await act(async () => {
      receipt = await result.current.dispatchWithErrorFeedback({
        type: "RESOLVE_WITH_AI_STARTED",
      });
    });

    expect(receipt).toBeUndefined();
    expect(mocks.showError).toHaveBeenCalledOnce();
  });

  it("shows the actionable message for GitHub operation backpressure", async () => {
    mocks.connection = "ready";
    mocks.remote = { ...mocks.remote, connection: "ready" };
    mocks.dispatch.mockRejectedValue(
      new DyadError(
        "Too many GitHub operations are still settling. Please try again.",
        DyadErrorKind.RateLimited,
      ),
    );
    const { result } = renderHook(() =>
      useGithubOps(7, { reconcileOnMount: false }),
    );

    await act(async () => {
      await result.current.dispatchWithErrorFeedback({
        type: "OP_REQUESTED",
        op: { type: "push", mode: "normal" },
      });
    });

    expect(mocks.showError).toHaveBeenCalledWith(
      "Too many GitHub operations are still settling. Please try again.",
    );
  });

  it("clears the local claim when cancellation dispatch rejects", async () => {
    mocks.connection = "ready";
    mocks.remote = { ...mocks.remote, connection: "ready" };
    mocks.dispatch
      .mockResolvedValueOnce({ kind: "applied", messageId: "claim-1" })
      .mockRejectedValueOnce(new Error("disconnected"))
      .mockResolvedValueOnce({ kind: "applied", messageId: "claim-2" });
    const { result } = renderHook(() =>
      useGithubOps(7, { reconcileOnMount: false }),
    );

    await act(async () => {
      await result.current.dispatchWithErrorFeedback({
        type: "RESOLVE_WITH_AI_STARTED",
      });
      await expect(
        result.current.dispatchConflictResolutionCancelled(),
      ).rejects.toThrow("disconnected");
      await result.current.dispatchWithErrorFeedback({
        type: "RESOLVE_WITH_AI_STARTED",
      });
    });

    expect(mocks.dispatch).toHaveBeenCalledTimes(3);
    expect(mocks.dispatch.mock.calls[2][0]).toMatchObject({
      type: "RESOLVE_WITH_AI_STARTED",
    });
  });
});
