import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatWorkspaceStatus } from "@/ipc/types";

const { getChatWorkspaceStatus } = vi.hoisted(() => ({
  getChatWorkspaceStatus: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: { workspace: { getChatWorkspaceStatus } },
}));

import { useChatWorkspaceStatus } from "./useChatWorkspace";

const STATUS = {
  chatId: 7,
  appId: 1,
  kind: "isolated",
  branch: "dyad/chat-7",
  targetBranch: "main",
  workspaceId: 3,
  runtimeAppId: 1_000_000_003,
  writableTurnRunning: false,
  hasUnmergedWork: false,
  packageManager: null,
  integration: null,
} satisfies ChatWorkspaceStatus;

function renderStatus(appId: number) {
  const client = new QueryClient();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useChatWorkspaceStatus(appId, 7), { wrapper });
}

describe("useChatWorkspaceStatus", () => {
  beforeEach(() => {
    getChatWorkspaceStatus.mockReset();
    getChatWorkspaceStatus.mockResolvedValue(STATUS);
  });

  it("returns the chat's workspace for its own app", async () => {
    const { result } = renderStatus(1);
    await waitFor(() => expect(result.current.data).toEqual(STATUS));
  });

  it("hides a workspace that belongs to another app", async () => {
    // During navigation the selected chat can still be the previous app's.
    const { result } = renderStatus(2);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });
});
