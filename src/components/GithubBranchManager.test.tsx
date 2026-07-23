import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("keeps recovery switching available while disabling branch mutations", () => {
    mocks.state = {
      type: "conflicted",
      files: ["src/a.ts"],
      origin: { type: "merge", branch: "feature" },
      banner: null,
    };

    render(<GithubBranchManager appId={1} />);

    expect(
      (screen.getByTestId("branch-select-trigger") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (screen.getByTestId("branch-actions-menu-trigger") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Cancel sync",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("preserves create input on failure and closes only after success", async () => {
    const view = render(<GithubBranchManager appId={1} />);

    fireEvent.click(screen.getByTestId("branch-actions-menu-trigger"));
    fireEvent.click(screen.getByTestId("create-branch-trigger"));
    fireEvent.change(screen.getByTestId("new-branch-name-input"), {
      target: { value: "feature/preserved" },
    });
    fireEvent.click(screen.getByTestId("create-branch-submit-button"));

    mocks.state = {
      type: "running",
      op: {
        type: "create-branch",
        name: "feature/preserved",
        thenSwitch: true,
      },
      next: { type: "switch", branch: "feature/preserved" },
      banner: null,
    };
    view.rerender(<GithubBranchManager appId={1} />);
    expect(screen.getByTestId("create-branch-submit-button").textContent).toBe(
      "Creating...",
    );

    mocks.state = {
      type: "idle",
      banner: {
        kind: "error",
        message: "Branch already exists",
      },
    };
    view.rerender(<GithubBranchManager appId={1} />);
    expect(
      (screen.getByTestId("new-branch-name-input") as HTMLInputElement).value,
    ).toBe("feature/preserved");

    mocks.state = {
      type: "idle",
      banner: {
        kind: "success",
        completedOperation: "create-branch",
        message: "Branch created",
      },
    };
    view.rerender(<GithubBranchManager appId={1} />);
    await waitFor(() =>
      expect(screen.queryByTestId("new-branch-name-input")).toBeNull(),
    );
  });

  it("closes the merge dialog when conflict recovery takes over", async () => {
    const view = render(<GithubBranchManager appId={1} />);

    fireEvent.click(screen.getByTestId("branches-header"));
    fireEvent.click(screen.getByTestId("branch-actions-feature"));
    fireEvent.click(screen.getByTestId("merge-branch-menu-item"));
    expect(screen.getByTestId("merge-branch-submit-button")).toBeDefined();

    mocks.state = {
      type: "conflicted",
      files: ["src/conflicted.ts"],
      origin: { type: "merge", branch: "feature" },
      banner: {
        kind: "error",
        code: "MERGE_CONFLICT",
        message: "Merge conflicts detected",
      },
    };
    view.rerender(<GithubBranchManager appId={1} />);

    await waitFor(() =>
      expect(screen.queryByTestId("merge-branch-submit-button")).toBeNull(),
    );
    expect(screen.getByTestId("branch-conflict-status")).toBeDefined();
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
