import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatWorkspaceStatus } from "@/ipc/types";
import { WorkspaceStatusIndicator } from "./WorkspaceStatusIndicator";

const state = vi.hoisted(() => ({
  status: undefined as ChatWorkspaceStatus | undefined,
  isolationEnabled: false,
  retry: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const copy: Record<string, string> = {
        "workspace.isolated": "Isolated workspace",
        "workspace.detachedBranch": "Earlier version",
        "workspace.statusQueued": "Waiting to merge",
        "workspace.statusResolvingConflicts": "Resolving conflicts",
        "workspace.statusValidating": "Checking combined changes",
        "workspace.statusMerged": `Merged into ${options?.target}`,
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
    isPending: false,
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

describe("WorkspaceStatusIndicator", () => {
  beforeEach(() => {
    state.status = undefined;
    state.isolationEnabled = false;
    state.retry.mockReset();
  });

  it("stays hidden for the default single-workspace setup", () => {
    state.status = status({});
    const { container } = render(
      <WorkspaceStatusIndicator appId={1} chatId={7} />,
    );
    expect(container.textContent).toBe("");
  });

  it("shows the branch of a chat in the app's main folder once isolation is on", () => {
    state.isolationEnabled = true;
    state.status = status({});
    render(<WorkspaceStatusIndicator appId={1} chatId={7} />);
    expect(screen.getByTestId("workspace-branch").textContent).toBe("main");
    expect(screen.queryByTestId("workspace-isolated-label")).toBeNull();
  });

  it("shows an isolated chat's branch and merge progress separately", () => {
    state.status = status({
      kind: "isolated",
      branch: "dyad/chat-7",
      targetBranch: "main",
      workspaceId: 3,
      runtimeAppId: 1_000_000_003,
      integration: {
        phase: "validating",
        detail: null,
        validation: null,
        canRetry: false,
      },
    });
    render(<WorkspaceStatusIndicator appId={1} chatId={7} />);
    expect(screen.getByTestId("workspace-branch").textContent).toBe(
      "dyad/chat-7",
    );
    expect(screen.getByTestId("workspace-isolated-label").textContent).toBe(
      "· Isolated workspace",
    );
    expect(
      screen.getByTestId("workspace-integration-status").textContent,
    ).toContain("Checking combined changes");
    expect(screen.queryByTestId("workspace-retry-merge")).toBeNull();
  });

  it("names the target branch once merged and offers retry when blocked", () => {
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
    const { rerender } = render(
      <WorkspaceStatusIndicator appId={1} chatId={7} />,
    );
    expect(
      screen.getByTestId("workspace-integration-status").textContent,
    ).toContain("Merged into develop");

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
    rerender(<WorkspaceStatusIndicator appId={1} chatId={7} />);
    expect(
      screen.getByTestId("workspace-integration-status").textContent,
    ).toContain("Merge blocked");
    fireEvent.click(screen.getByTestId("workspace-retry-merge"));
    expect(state.retry).toHaveBeenCalledWith(7, expect.any(Object));
  });
});
