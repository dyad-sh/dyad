import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useVercelProjectSetup,
  useVercelTokenSetup,
} from "./VercelConnector.hooks";

const mocks = vi.hoisted(() => ({
  refreshApp: vi.fn(),
  refreshSettings: vi.fn(),
  saveToken: vi.fn(),
  listProjects: vi.fn(),
  isProjectAvailable: vi.fn(),
  createProject: vi.fn(),
  connectExistingProject: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    vercel: {
      saveToken: mocks.saveToken,
      listProjects: mocks.listProjects,
      isProjectAvailable: mocks.isProjectAvailable,
      createProject: mocks.createProject,
      connectExistingProject: mocks.connectExistingProject,
    },
  },
}));

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useVercelTokenSetup", () => {
  beforeEach(() => {
    mocks.refreshSettings.mockReset();
    mocks.saveToken.mockReset();
  });

  it("saves a token and clears it after success", async () => {
    mocks.saveToken.mockResolvedValue(undefined);
    const { result } = renderHook(
      () => useVercelTokenSetup({ refreshSettings: mocks.refreshSettings }),
      { wrapper: makeWrapper() },
    );

    act(() => result.current.actions.setToken("vercel-token"));

    expect(result.current.canSubmit).toBe(true);

    await act(async () => {
      await result.current.actions.submit();
    });

    expect(mocks.saveToken).toHaveBeenCalledWith({ token: "vercel-token" });
    expect(mocks.refreshSettings).toHaveBeenCalled();
    expect(result.current.state).toMatchObject({
      accessToken: "",
      isSavingToken: false,
      tokenSuccess: true,
      tokenError: null,
    });
  });

  it("does not save or report success for a blank token", async () => {
    const { result } = renderHook(
      () => useVercelTokenSetup({ refreshSettings: mocks.refreshSettings }),
      { wrapper: makeWrapper() },
    );

    act(() => result.current.actions.setToken("   "));

    expect(result.current.canSubmit).toBe(false);

    await act(async () => {
      await result.current.actions.submit();
    });

    expect(mocks.saveToken).not.toHaveBeenCalled();
    expect(mocks.refreshSettings).not.toHaveBeenCalled();
    expect(result.current.state.tokenSuccess).toBe(false);
  });
});

describe("useVercelProjectSetup", () => {
  beforeEach(() => {
    mocks.refreshApp.mockReset();
    mocks.listProjects.mockReset().mockResolvedValue([]);
    mocks.isProjectAvailable.mockReset();
    mocks.createProject.mockReset();
    mocks.connectExistingProject.mockReset();
  });

  function renderProjectSetup(appId: number | null = 42) {
    return renderHook(
      () =>
        useVercelProjectSetup({
          appId,
          folderName: "My App",
          hasVercelCredentials: true,
          refreshApp: mocks.refreshApp,
        }),
      { wrapper: makeWrapper() },
    );
  }

  it("clears submit feedback when switching modes", async () => {
    mocks.createProject.mockRejectedValue(new Error("boom"));

    const { result } = renderProjectSetup();

    await act(async () => {
      await result.current.actions.submit();
    });

    await waitFor(() => {
      expect(result.current.state.createProjectError).toBe("boom");
    });
    expect(mocks.refreshApp).not.toHaveBeenCalled();

    act(() => result.current.actions.setMode("existing"));

    await waitFor(() => {
      expect(result.current.state.createProjectError).toBeNull();
      expect(result.current.state.createProjectSuccess).toBe(false);
    });
  });

  it("does not report success or refresh the app without an app", async () => {
    const { result } = renderProjectSetup(null);

    expect(result.current.canSubmit).toBe(false);

    await act(async () => {
      await result.current.actions.submit();
    });

    expect(mocks.createProject).not.toHaveBeenCalled();
    expect(result.current.state.createProjectSuccess).toBe(false);
    expect(mocks.refreshApp).not.toHaveBeenCalled();
  });
});
