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
  retry: vi.fn(),
  retryPending: false,
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
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { enableWorktreeIsolation: state.isolationEnabled },
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
    state.retry.mockReset();
    state.retryPending = false;
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
