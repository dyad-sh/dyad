import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useGitHubDeviceFlow,
  useGitHubRepoSetup,
} from "./GitHubConnector.hooks";

const mocks = vi.hoisted(() => ({
  flowErrorListeners: new Set<(data: { error?: string }) => void>(),
  flowSuccessListeners: new Set<(data: unknown) => void>(),
  flowUpdateListeners: new Set<
    (data: {
      userCode?: string;
      verificationUri?: string;
      message?: string;
    }) => void
  >(),
  onConnected: vi.fn(),
  refreshSettings: vi.fn(),
  startFlow: vi.fn(),
  listRepos: vi.fn(),
  getRepoBranches: vi.fn(),
  isRepoAvailable: vi.fn(),
  createRepo: vi.fn(),
  connectExistingRepo: vi.fn(),
  onSetupComplete: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    github: {
      startFlow: mocks.startFlow,
      listRepos: mocks.listRepos,
      getRepoBranches: mocks.getRepoBranches,
      isRepoAvailable: mocks.isRepoAvailable,
      createRepo: mocks.createRepo,
      connectExistingRepo: mocks.connectExistingRepo,
    },
    events: {
      github: {
        onFlowError: (listener: (data: { error?: string }) => void) => {
          mocks.flowErrorListeners.add(listener);
          return () => mocks.flowErrorListeners.delete(listener);
        },
        onFlowSuccess: (listener: (data: unknown) => void) => {
          mocks.flowSuccessListeners.add(listener);
          return () => mocks.flowSuccessListeners.delete(listener);
        },
        onFlowUpdate: (
          listener: (data: {
            userCode?: string;
            verificationUri?: string;
            message?: string;
          }) => void,
        ) => {
          mocks.flowUpdateListeners.add(listener);
          return () => mocks.flowUpdateListeners.delete(listener);
        },
      },
    },
  },
}));

describe("useGitHubDeviceFlow", () => {
  beforeEach(() => {
    mocks.flowErrorListeners.clear();
    mocks.flowSuccessListeners.clear();
    mocks.flowUpdateListeners.clear();
    mocks.onConnected.mockReset();
    mocks.refreshSettings.mockReset();
    mocks.startFlow.mockReset();
  });

  it("starts device auth and reacts to flow events", () => {
    const { result } = renderHook(() =>
      useGitHubDeviceFlow({
        appId: 42,
        refreshSettings: mocks.refreshSettings,
        onConnected: mocks.onConnected,
      }),
    );

    act(() => result.current.connect());

    expect(mocks.startFlow).toHaveBeenCalledWith({ appId: 42 });
    expect(result.current.isConnecting).toBe(true);
    expect(result.current.flow.status).toBe("requesting");

    act(() => {
      mocks.flowUpdateListeners.forEach((listener) =>
        listener({
          userCode: "ABCD-EFGH",
          verificationUri: "https://github.com/login/device",
          message: "Waiting for authorization...",
        }),
      );
    });

    expect(result.current.flow).toMatchObject({
      status: "waiting",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
      message: "Waiting for authorization...",
    });

    act(() => {
      mocks.flowSuccessListeners.forEach((listener) => listener({}));
    });

    expect(result.current.flow.status).toBe("connected");
    expect(result.current.isConnecting).toBe(false);
    expect(mocks.refreshSettings).toHaveBeenCalled();
    expect(mocks.onConnected).toHaveBeenCalled();
  });
});

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return { queryClient, Wrapper };
}

describe("useGitHubRepoSetup", () => {
  beforeEach(() => {
    mocks.listRepos.mockReset().mockResolvedValue([]);
    mocks.getRepoBranches.mockReset();
    mocks.isRepoAvailable.mockReset();
    mocks.createRepo.mockReset();
    mocks.connectExistingRepo.mockReset();
    mocks.onSetupComplete.mockReset();
  });

  function renderRepoSetup(appId: number | null = 42) {
    const { queryClient, Wrapper } = makeWrapper();
    const view = renderHook(
      () =>
        useGitHubRepoSetup({
          appId,
          folderName: "My App",
          hasGitHubCredentials: true,
          onSetupComplete: mocks.onSetupComplete,
        }),
      { wrapper: Wrapper },
    );
    return { ...view, queryClient };
  }

  it("keeps the user's branch selection when branches refetch", async () => {
    let sha = 0;
    mocks.getRepoBranches.mockImplementation(async () => [
      { name: "develop", commit: { sha: `${++sha}` } },
      { name: "main", commit: { sha: `${++sha}` } },
    ]);

    const { result, queryClient } = renderRepoSetup();

    act(() => result.current.actions.setMode("existing"));
    act(() => result.current.actions.selectRepo("owner/repo"));

    // Wait for the first load (and its branch-defaults dispatch) to land.
    await waitFor(() => {
      expect(result.current.state.availableBranches).toHaveLength(2);
    });
    expect(result.current.state.selectedBranch).toBe("main");

    act(() => result.current.actions.useCustomBranch());
    act(() => result.current.actions.setCustomBranch("feature/x"));

    // A background refetch (e.g. window refocus) returns new data references
    // but must not reset the user's branch selection back to the default.
    await act(async () => {
      await queryClient.refetchQueries();
    });

    expect(mocks.getRepoBranches).toHaveBeenCalledTimes(2);
    expect(result.current.state.branchInputMode).toBe("custom");
    expect(result.current.state.customBranchName).toBe("feature/x");
  });

  it("re-applies branch defaults when a different repo is selected", async () => {
    mocks.getRepoBranches.mockImplementation(
      async ({ repo }: { owner: string; repo: string }) => [
        { name: `${repo}-branch`, commit: { sha: "1" } },
      ],
    );

    const { result } = renderRepoSetup();

    act(() => result.current.actions.setMode("existing"));
    act(() => result.current.actions.selectRepo("owner/one"));

    await waitFor(() => {
      expect(result.current.state.selectedBranch).toBe("one-branch");
    });

    act(() => result.current.actions.selectRepo("owner/two"));

    await waitFor(() => {
      expect(result.current.state.selectedBranch).toBe("two-branch");
    });
  });

  it("clears submit feedback when switching modes", async () => {
    mocks.createRepo.mockRejectedValue(new Error("boom"));

    const { result } = renderRepoSetup();

    await act(async () => {
      await result.current.actions.submit();
    });

    await waitFor(() => {
      expect(result.current.state.createRepoError).toBe("boom");
    });
    expect(mocks.onSetupComplete).not.toHaveBeenCalled();

    act(() => result.current.actions.setMode("existing"));

    await waitFor(() => {
      expect(result.current.state.createRepoError).toBeNull();
      expect(result.current.state.createRepoSuccess).toBe(false);
    });
  });

  it("does not report success or complete setup without an app", async () => {
    const { result } = renderRepoSetup(null);

    expect(result.current.canSubmit).toBe(false);

    await act(async () => {
      await result.current.actions.submit();
    });

    expect(mocks.createRepo).not.toHaveBeenCalled();
    expect(result.current.state.createRepoSuccess).toBe(false);
    expect(mocks.onSetupComplete).not.toHaveBeenCalled();
  });
});
