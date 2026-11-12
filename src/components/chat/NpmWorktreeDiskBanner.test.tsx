import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatWorkspaceStatus } from "@/ipc/types";
import {
  NpmWorktreeDiskBanner,
  PNPM_INSTALL_URL,
} from "./NpmWorktreeDiskBanner";

const state = vi.hoisted(() => ({
  status: undefined as ChatWorkspaceStatus | undefined,
  openExternalUrl: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "workspace.npmDiskBannerMessage":
          "npm copies node_modules per worktree",
        "workspace.npmDiskBannerAction": "Get pnpm",
      })[key] ?? key,
  }),
}));

vi.mock("@/hooks/useChatWorkspace", () => ({
  useChatWorkspaceStatus: () => ({ data: state.status }),
}));

vi.mock("@/ipc/types", () => ({
  ipc: { system: { openExternalUrl: state.openExternalUrl } },
}));

function isolated(
  packageManager: ChatWorkspaceStatus["packageManager"],
): ChatWorkspaceStatus {
  return {
    chatId: 7,
    appId: 1,
    kind: "isolated",
    branch: "dyad/chat-7",
    targetBranch: "main",
    workspaceId: 3,
    runtimeAppId: 1_000_000_003,
    writableTurnRunning: false,
    hasUnmergedWork: false,
    packageManager,
    integration: null,
  };
}

function renderBanner() {
  return render(
    <Provider>
      <NpmWorktreeDiskBanner appId={1} chatId={7} />
    </Provider>,
  );
}

describe("NpmWorktreeDiskBanner", () => {
  beforeEach(() => {
    state.status = undefined;
    state.openExternalUrl.mockReset();
  });

  it("advises pnpm for a worktree that installs with npm", () => {
    state.status = isolated("npm");
    renderBanner();
    expect(
      screen.getByTestId("npm-worktree-disk-banner").textContent,
    ).toContain("npm copies node_modules per worktree");
    fireEvent.click(screen.getByText("Get pnpm"));
    expect(state.openExternalUrl).toHaveBeenCalledWith(PNPM_INSTALL_URL);
  });

  it("stays hidden for pnpm worktrees", () => {
    state.status = isolated("pnpm");
    renderBanner();
    expect(screen.queryByTestId("npm-worktree-disk-banner")).toBeNull();
  });

  it("stays dismissed for the app once closed", () => {
    state.status = isolated("npm");
    const { rerender } = renderBanner();
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByTestId("npm-worktree-disk-banner")).toBeNull();
    rerender(
      <Provider>
        <NpmWorktreeDiskBanner appId={1} chatId={7} />
      </Provider>,
    );
    expect(screen.queryByTestId("npm-worktree-disk-banner")).toBeNull();
  });
});
