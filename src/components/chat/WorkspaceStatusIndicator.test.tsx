import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatWorkspaceStatus } from "@/ipc/types";
import {
  WorkspaceIntegrationStatus,
  WorkspaceStatusIndicator,
} from "./WorkspaceStatusIndicator";

const state = vi.hoisted(() => ({
  status: undefined as ChatWorkspaceStatus | undefined,
  isolationEnabled: false,
  // `useSettings` returns `settings: null` until the query resolves.
  settingsLoaded: true,
  retry: vi.fn(),
  retryPending: false,
  deleteWorkspace: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const copy: Record<string, string> = {
        "workspace.isolated": "Isolated workspace",
        "workspace.detachedBranch": "Earlier version",
        "workspace.originalTooltip": `This chat works in the app's main folder on ${options?.branch}.`,
        "workspace.isolatedTooltip": `This chat works on its own branch and folder. Dyad merges its finished work into ${options?.target} after checking the combined code.`,
        "workspace.statusQueued": "Waiting to merge",
        "workspace.statusMerging": `Combining with ${options?.target}`,
        "workspace.statusResolvingConflicts": "Resolving conflicts",
        "workspace.statusValidating": "Checking combined changes",
        "workspace.statusIntegrating": `Merging into ${options?.target}`,
        "workspace.statusMerged": `Merged into ${options?.target}`,
        "workspace.statusPaused": "Merge paused",
        "workspace.statusFailed": "Merge blocked",
        "workspace.retryMerge": "Retry merge",
        "workspace.deleteWorktree": "Delete worktree",
        "workspace.deleteWorktreeBusy": "Busy",
        "workspace.deleteWorktreeMerged": `Merged into ${options?.target} already.`,
        "workspace.deleteWorktreeUnmerged": `Unmerged commits stay on ${options?.branch}.`,
        "workspace.deleteWorktreeNextIsolated":
          "Next message gets a new worktree.",
        "workspace.deleteWorktreeNextShared":
          "Next message uses the main folder.",
      };
      return copy[key] ?? key;
    },
  }),
}));

vi.mock("@/hooks/useChatWorkspace", () => ({
  useChatWorkspaceStatus: () => ({ data: state.status }),
  useRetryWorkspaceIntegration: () => ({
    isPending: state.retryPending,
    mutate: state.retry,
  }),
  useDeleteChatWorkspace: () => ({
    isPending: false,
    mutate: state.deleteWorkspace,
  }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: state.settingsLoaded
      ? { enableWorktreeIsolation: state.isolationEnabled }
      : null,
  }),
}));

function status(overrides: Partial<ChatWorkspaceStatus>): ChatWorkspaceStatus {
  return {
    chatId: 7,
    appId: 1,
    kind: "original",
    branch: "main",
    targetBranch: null,
    workspaceId: null,
    runtimeAppId: 1,
    writableTurnRunning: false,
    hasUnmergedWork: false,
    packageManager: null,
    integration: null,
    ...overrides,
  };
}

function WorkspaceIndicators() {
  return (
    <>
      <WorkspaceStatusIndicator appId={1} chatId={7} />
      <WorkspaceIntegrationStatus appId={1} chatId={7} />
    </>
  );
}

describe("WorkspaceStatusIndicator", () => {
  beforeEach(() => {
    state.status = undefined;
    state.isolationEnabled = false;
    state.settingsLoaded = true;
    state.retry.mockReset();
    state.retryPending = false;
    state.deleteWorkspace.mockReset();
  });

  const isolated = (overrides: Partial<ChatWorkspaceStatus> = {}) =>
    status({
      kind: "isolated",
      branch: "dyad/chat-7",
      targetBranch: "main",
      workspaceId: 3,
      runtimeAppId: 1_000_000_003,
      ...overrides,
    });

  it("offers deleting a worktree only for a chat that has one", () => {
    state.isolationEnabled = true;
    state.status = status({});
    const { rerender } = render(<WorkspaceIndicators />);
    expect(screen.queryByTestId("workspace-delete-worktree")).toBeNull();

    state.status = isolated();
    rerender(<WorkspaceIndicators />);
    expect(
      screen
        .getByTestId("workspace-delete-worktree")
        .getAttribute("aria-label"),
    ).toBe("Delete worktree");
  });

  it("confirms before deleting a merged worktree", async () => {
    state.isolationEnabled = true;
    state.status = isolated({
      integration: {
        phase: "merged",
        detail: null,
        validation: null,
        canRetry: false,
      },
    });
    render(<WorkspaceIndicators />);
    fireEvent.click(screen.getByTestId("workspace-delete-worktree"));
    const dialog = await screen.findByTestId("delete-worktree-dialog");
    expect(dialog.textContent).toContain("Merged into main already.");
    expect(dialog.textContent).toContain("Next message gets a new worktree.");
    expect(state.deleteWorkspace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("workspace-delete-worktree-confirm"));
    expect(state.deleteWorkspace).toHaveBeenCalledWith(7, expect.any(Object));
  });

  it("explains what happens to unmerged work", async () => {
    state.status = isolated({
      hasUnmergedWork: true,
      integration: {
        phase: "failed",
        detail: "build failed",
        validation: null,
        canRetry: true,
      },
    });
    render(<WorkspaceIndicators />);
    fireEvent.click(screen.getByTestId("workspace-delete-worktree"));
    const dialog = await screen.findByTestId("delete-worktree-dialog");
    expect(dialog.textContent).toContain(
      "Unmerged commits stay on dyad/chat-7.",
    );
    // With isolation off, the chat goes back to the app's folder.
    expect(dialog.textContent).toContain("Next message uses the main folder.");
  });

  it("does not say where the next message works until settings load", async () => {
    state.settingsLoaded = false;
    state.status = isolated({ hasUnmergedWork: true });
    render(<WorkspaceIndicators />);
    fireEvent.click(screen.getByTestId("workspace-delete-worktree"));
    const dialog = await screen.findByTestId("delete-worktree-dialog");
    expect(dialog.textContent).toContain(
      "Unmerged commits stay on dyad/chat-7.",
    );
    // An unknown setting is not "off": neither outcome is claimed.
    expect(dialog.textContent).not.toContain(
      "Next message uses the main folder.",
    );
    expect(dialog.textContent).not.toContain(
      "Next message gets a new worktree.",
    );
  });

  it("warns about edits a stopped turn left after the last merge", async () => {
    state.status = isolated({
      hasUnmergedWork: true,
      integration: {
        phase: "merged",
        detail: null,
        validation: null,
        canRetry: false,
      },
    });
    render(<WorkspaceIndicators />);
    fireEvent.click(screen.getByTestId("workspace-delete-worktree"));
    const dialog = await screen.findByTestId("delete-worktree-dialog");
    expect(dialog.textContent).toContain(
      "Unmerged commits stay on dyad/chat-7.",
    );
    expect(dialog.textContent).not.toContain("Merged into main already.");
  });

  it.each([
    ["the chat's agent is running", { writableTurnRunning: true }],
    [
      "a merge step is running",
      {
        integration: {
          phase: "validating" as const,
          detail: null,
          validation: null,
          canRetry: false,
        },
      },
    ],
  ])("keeps deletion unavailable while %s", (_label, overrides) => {
    state.isolationEnabled = true;
    state.status = isolated(overrides);
    render(<WorkspaceIndicators />);
    const button = screen.getByTestId("workspace-delete-worktree");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(screen.queryByTestId("delete-worktree-dialog")).toBeNull();
  });

  it("stays hidden for the default single-workspace setup", () => {
    state.status = status({});
    const { container } = render(<WorkspaceIndicators />);
    expect(container.textContent).toBe("");
  });

  it("shows main as a keyboard-accessible badge without a separate status row", async () => {
    state.isolationEnabled = true;
    state.status = status({});
    render(<WorkspaceIndicators />);
    expect(screen.getByTestId("workspace-branch").textContent).toBe("main");
    expect(screen.queryByTestId("workspace-integration-row")).toBeNull();
    const badge = screen.getByTestId("chat-workspace-indicator");
    expect(badge.tabIndex).toBe(0);
    act(() => badge.focus());
    expect((await screen.findByRole("tooltip")).textContent).toContain(
      "This chat works in the app's main folder on main.",
    );
    expect(badge.getAttribute("aria-describedby")).toBe(
      screen.getByRole("tooltip").id,
    );
  });

  it("keeps full branch and isolation details accessible when the setting is off", async () => {
    const branch = "dyad/a-very-long-isolated-workspace-branch-name";
    state.status = status({
      kind: "isolated",
      branch,
      targetBranch: "develop",
    });
    render(<WorkspaceIndicators />);
    expect(screen.getByTestId("workspace-branch").textContent).toBe(branch);
    expect(screen.queryByTestId("workspace-integration-row")).toBeNull();
    act(() => screen.getByTestId("chat-workspace-indicator").focus());
    const tooltip = await screen.findByRole("tooltip");
    expect(within(tooltip).getByText(branch)).toBeTruthy();
    expect(within(tooltip).getByText("Isolated workspace")).toBeTruthy();
    expect(tooltip.textContent).toContain("into develop");
  });

  it.each([
    ["queued", "Waiting to merge"],
    ["merging", "Combining with main"],
    ["resolving-conflicts", "Resolving conflicts"],
    ["validating", "Checking combined changes"],
    ["integrating", "Merging into main"],
    ["paused", "Merge paused"],
  ] as const)("shows %s separately from the branch badge", (phase, label) => {
    state.status = status({
      kind: "isolated",
      branch: "dyad/chat-7",
      targetBranch: "main",
      workspaceId: 3,
      runtimeAppId: 1_000_000_003,
      integration: {
        phase,
        detail: null,
        validation: null,
        canRetry: false,
      },
    });
    render(<WorkspaceIndicators />);
    expect(screen.getByTestId("workspace-branch").textContent).toBe(
      "dyad/chat-7",
    );
    expect(
      screen.getByTestId("workspace-integration-status").textContent,
    ).toContain(label);
    expect(screen.getByRole("status").textContent).toBe(label);
    expect(
      within(screen.getByTestId("chat-workspace-indicator")).queryByRole(
        "status",
      ),
    ).toBeNull();
    expect(screen.queryByTestId("workspace-retry-merge")).toBeNull();
  });

  it("moves completed merge details into the badge and offers retry when blocked", async () => {
    state.status = status({
      kind: "isolated",
      branch: "dyad/chat-7",
      targetBranch: "develop",
      workspaceId: 3,
      integration: {
        phase: "merged",
        detail: null,
        validation: null,
        canRetry: false,
      },
    });
    const { rerender } = render(<WorkspaceIndicators />);
    expect(
      screen.getByTestId("chat-workspace-indicator").textContent,
    ).toContain("Merged into develop");
    expect(screen.queryByTestId("workspace-integration-row")).toBeNull();
    act(() => screen.getByTestId("chat-workspace-indicator").focus());
    expect((await screen.findByRole("tooltip")).textContent).toContain(
      "Merged into develop",
    );
    act(() => screen.getByTestId("chat-workspace-indicator").blur());

    state.status = status({
      ...state.status,
      integration: {
        phase: "failed",
        detail: "build failed",
        validation: [
          {
            name: "build",
            outcome: "failed",
            summary: "npm run build failed.",
          },
        ],
        canRetry: true,
      },
    });
    rerender(<WorkspaceIndicators />);
    expect(
      screen.getByTestId("workspace-integration-status").textContent,
    ).toContain("Merge blocked");
    fireEvent.click(screen.getByTestId("workspace-retry-merge"));
    expect(state.retry).toHaveBeenCalledWith(7, expect.any(Object));
    act(() => screen.getByTestId("workspace-integration-status").focus());
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toContain("build failed");
    expect(tooltip.textContent).toContain("build: npm run build failed.");

    state.retryPending = true;
    rerender(<WorkspaceIndicators />);
    expect(
      (screen.getByRole("button", { name: "Retry merge" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry merge" }));
    expect(state.retry).toHaveBeenCalledTimes(1);
  });

  it.each([
    undefined,
    status({ branch: null }),
    status({
      integration: {
        phase: "idle",
        detail: null,
        validation: null,
        canRetry: false,
      },
    }),
  ])(
    "does not reserve a status row without merge activity (%j)",
    (workspace) => {
      state.isolationEnabled = true;
      state.status = workspace;
      render(<WorkspaceIndicators />);
      expect(screen.queryByTestId("workspace-integration-row")).toBeNull();
      if (workspace?.branch === null) {
        expect(screen.getByTestId("workspace-branch").textContent).toBe(
          "Earlier version",
        );
      }
    },
  );
});
