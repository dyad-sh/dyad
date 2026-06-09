import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGitHubDeviceFlow } from "./GitHubConnector.hooks";

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
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    github: {
      startFlow: mocks.startFlow,
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
