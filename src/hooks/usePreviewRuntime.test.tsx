import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider, createStore } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { previewNativeViewAppIdAtom } from "@/atoms/previewAtoms";
import type { AppWorkspaceOverview, ChatWorkspaceStatus } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

const { getChatWorkspaceStatus, getAppWorkspaceOverview } = vi.hoisted(() => ({
  getChatWorkspaceStatus: vi.fn(),
  getAppWorkspaceOverview: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: { workspace: { getChatWorkspaceStatus, getAppWorkspaceOverview } },
}));

import { usePreviewRuntime } from "./usePreviewRuntime";

const ISOLATED_STATUS = {
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

function overviewWith(
  workspaces: AppWorkspaceOverview["workspaces"],
): AppWorkspaceOverview {
  return {
    appId: 1,
    isolationEnabled: true,
    writableChatIds: [],
    workspaces,
  };
}

function never(): Promise<never> {
  return new Promise(() => {});
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
  return { client, store, resolutions, ...view };
}

describe("usePreviewRuntime", () => {
  beforeEach(() => {
    getChatWorkspaceStatus.mockReset();
    getAppWorkspaceOverview.mockReset();
  });

  it("previews an isolated chat's workspace runtime once it is known", async () => {
    getChatWorkspaceStatus.mockResolvedValue(ISOLATED_STATUS);
    getAppWorkspaceOverview.mockImplementation(never);
    const { result } = setup();
    // Nothing starts, and nothing is shown, until the chat's workspace is
    // known: the app's own folder is not what an isolated chat previews.
    expect(result.current).toEqual({
      runtimeAppId: null,
      appId: 1,
      resolved: false,
      isWorkspace: false,
    });
    await waitFor(() =>
      expect(result.current).toEqual({
        runtimeAppId: 1_000_000_003,
        appId: 1,
        resolved: true,
        isWorkspace: true,
      }),
    );
  });

  it("uses the app's workspace list while the chat's own lookup is in flight", async () => {
    getChatWorkspaceStatus.mockImplementation(never);
    getAppWorkspaceOverview.mockResolvedValue(
      overviewWith([
        { chatId: 7, workspaceId: 3, branch: "dyad/chat-7", phase: "idle" },
      ]),
    );
    const { result, store } = setup();
    await waitFor(() =>
      expect(result.current).toEqual({
        runtimeAppId: 1_000_000_003,
        appId: 1,
        resolved: true,
        isWorkspace: true,
      }),
    );

    // A chat the list does not name runs in the app's folder: switching to it
    // keeps the app's preview rather than blanking it.
    act(() => store.set(selectedChatIdAtom, 8));
    expect(result.current).toEqual({
      runtimeAppId: 1,
      appId: 1,
      resolved: true,
      isWorkspace: false,
    });
  });

  it("keeps the app's preview when the selected chat belongs to another app", async () => {
    getChatWorkspaceStatus.mockResolvedValue({ ...ISOLATED_STATUS, appId: 2 });
    getAppWorkspaceOverview.mockImplementation(never);
    const { result } = setup();
    await waitFor(() =>
      expect(result.current).toEqual({
        runtimeAppId: 1,
        appId: 1,
        resolved: true,
        isWorkspace: false,
      }),
    );
  });

  it("follows the app's own runtime while a test run drives the native view", async () => {
    getChatWorkspaceStatus.mockResolvedValue(ISOLATED_STATUS);
    getAppWorkspaceOverview.mockImplementation(never);
    const { result, store } = setup();
    await waitFor(() => expect(result.current.isWorkspace).toBe(true));

    act(() => store.set(previewNativeViewAppIdAtom, 1));
    expect(result.current).toEqual({
      runtimeAppId: 1,
      appId: 1,
      resolved: true,
      isWorkspace: false,
    });

    act(() => store.set(previewNativeViewAppIdAtom, null));
    expect(result.current.runtimeAppId).toBe(1_000_000_003);
  });

  it("stays on the app's folder after a failed lookup, even while refetching", async () => {
    // Like an IPC round trip, the failure arrives a moment later.
    const failLater = () =>
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Invalid channel")), 20),
      );
    getChatWorkspaceStatus.mockImplementation(failLater);
    getAppWorkspaceOverview.mockImplementation(failLater);
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
