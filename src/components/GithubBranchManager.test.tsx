import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectGithubOps } from "@/github_ops/projection";
import type { GithubOpsState } from "@/github_ops/state";
import { GithubBranchManager } from "./GithubBranchManager";

const mocks = vi.hoisted(() => ({
  inventory: {
    data: {
      branches: ["feature", "main"],
      currentBranch: "main",
    },
    isFetching: false,
    refetch: vi.fn(),
  },
  send: vi.fn(),
  state: null as GithubOpsState | null,
}));

vi.mock("@/github_ops/useGithubBranchInventory", () => ({
  useGithubBranchInventory: () => mocks.inventory,
}));

vi.mock("@/github_ops/useGithubOps", () => ({
  useGithubOps: () => ({
    projection: projectGithubOps(mocks.state!),
    send: mocks.send,
  }),
}));

describe("GithubBranchManager machine projection", () => {
  beforeEach(() => {
    mocks.send.mockReset();
    mocks.inventory.refetch.mockReset();
    mocks.inventory.isFetching = false;
    mocks.state = { type: "idle", banner: null };
  });

  it("disables branch controls while switch is running", () => {
    mocks.state = {
      type: "running",
      op: { type: "switch", branch: "feature" },
      banner: null,
    };

    render(<GithubBranchManager appId={1} />);

    expect(
      (screen.getByTestId("branch-select-trigger") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("branch-actions-menu-trigger") as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(screen.getByTestId("branches-header"));
    expect(
      (screen.getByTestId("branch-actions-feature") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("renders switch-blocked dialog data and dispatches confirmation", () => {
    mocks.state = {
      type: "switch-blocked",
      target: "feature",
      blockingOp: "merge",
      hasConflicts: true,
      banner: null,
    };

    render(<GithubBranchManager appId={1} />);

    screen.getByText("Merge in Progress");
    screen.getByText("Unresolved conflicts detected");
    expect(screen.getAllByText("feature").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("abort-confirmation-proceed"));
    expect(mocks.send).toHaveBeenCalledWith({
      type: "ABORT_AND_SWITCH_CONFIRMED",
    });
  });

  it("renders conflict status from the machine without a duplicate resolver", () => {
    mocks.state = {
      type: "conflicted",
      files: ["src/a.ts", "src/b.ts"],
      origin: { type: "merge", branch: "feature" },
      banner: null,
    };

    render(<GithubBranchManager appId={1} />);

    expect(screen.getByTestId("branch-conflict-status").textContent).toContain(
      "src/a.ts, src/b.ts",
    );
    expect(
      screen.queryByRole("button", {
        name: "Resolve merge conflicts with AI",
      }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel sync" }));
    expect(mocks.send).toHaveBeenCalledWith({
      type: "OP_REQUESTED",
      op: { type: "merge-abort" },
    });
  });

  it("removes all conflict UI once abort-and-switch is running", () => {
    mocks.state = {
      type: "switch-blocked",
      target: "feature",
      blockingOp: "merge",
      hasConflicts: true,
      banner: null,
    };
    const view = render(<GithubBranchManager appId={1} />);

    fireEvent.click(screen.getByTestId("abort-confirmation-proceed"));
    mocks.state = {
      type: "running",
      op: { type: "merge-abort" },
      next: { type: "switch", branch: "feature" },
      banner: null,
    };
    view.rerender(<GithubBranchManager appId={1} />);

    expect(screen.queryByTestId("branch-conflict-status")).toBeNull();
    expect(screen.queryByText("Merge in Progress")).toBeNull();
  });
});
