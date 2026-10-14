import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider, createStore } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import type { ChatWorkspaceStatus } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

const { getChatWorkspaceStatus } = vi.hoisted(() => ({
  getChatWorkspaceStatus: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: { workspace: { getChatWorkspaceStatus } },
}));

import { usePreviewRuntime } from "./usePreviewRuntime";

function setup() {
  const client = new QueryClient();
  const store = createStore();
  store.set(selectedAppIdAtom, 1);
  store.set(selectedChatIdAtom, 7);
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <Provider store={store}>{children}</Provider>
    </QueryClientProvider>
  );
  const resolutions: boolean[] = [];
  const view = renderHook(
    () => {
      const runtime = usePreviewRuntime();
      resolutions.push(runtime.resolved);
      return runtime;
    },
    { wrapper },
  );
  return { client, resolutions, ...view };
}

describe("usePreviewRuntime", () => {
  beforeEach(() => {
    getChatWorkspaceStatus.mockReset();
  });

  it("previews an isolated chat's workspace runtime once it is known", async () => {
    getChatWorkspaceStatus.mockResolvedValue({
      chatId: 7,
      appId: 1,
      kind: "isolated",
      branch: "dyad/chat-7",
      targetBranch: "main",
      workspaceId: 3,
      runtimeAppId: 1_000_000_003,
      writableTurnRunning: false,
      integration: null,
    } satisfies ChatWorkspaceStatus);
    const { result } = setup();
    // Nothing starts until the chat's workspace is known.
    expect(result.current.resolved).toBe(false);
    await waitFor(() =>
      expect(result.current).toEqual({
        runtimeAppId: 1_000_000_003,
        appId: 1,
        resolved: true,
        isWorkspace: true,
      }),
    );
  });

  it("stays on the app's folder after a failed lookup, even while refetching", async () => {
    // Like an IPC round trip, the failure arrives a moment later.
    getChatWorkspaceStatus.mockImplementation(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Invalid channel")), 20),
        ),
    );
    const { client, result, resolutions } = setup();
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current).toMatchObject({
      runtimeAppId: 1,
      isWorkspace: false,
    });

    // Workspace changes invalidate the lookup often. A failed lookup that
    // flipped back to unresolved on each refetch restarted the preview in a
    // loop.
    const settledAt = resolutions.length;
    for (let attempt = 0; attempt < 3; attempt++) {
      await act(() =>
        client.invalidateQueries({ queryKey: queryKeys.workspaces.all }),
      );
    }
    expect(getChatWorkspaceStatus).toHaveBeenCalledTimes(4);
    expect(resolutions.slice(settledAt)).not.toContain(false);
  });
});
