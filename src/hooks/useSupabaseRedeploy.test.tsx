import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type TestProgress = {
  appId: number;
  operationId: string;
  completed: number;
  total: number;
};

const mocks = vi.hoisted(() => {
  const progressListeners = new Set<(progress: TestProgress) => void>();
  return {
    progressListeners,
    redeployAllFunctions: vi.fn(),
    onRedeployProgress: vi.fn((listener: (progress: TestProgress) => void) => {
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    }),
  };
});

vi.mock("@/ipc/types", () => ({
  ipc: {
    supabase: { redeployAllFunctions: mocks.redeployAllFunctions },
    events: {
      supabase: { onRedeployProgress: mocks.onRedeployProgress },
    },
  },
}));

import { useRedeploySupabaseFunctions } from "./useSupabase";

describe("useRedeploySupabaseFunctions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.progressListeners.clear();
  });

  it("keeps the app-scoped pending state across connector remounts", async () => {
    let finishRedeploy: (value: {
      functionCount: number;
      prunedFunctionNames: string[];
      errors: string[];
    }) => void = () => {};
    mocks.redeployAllFunctions.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRedeploy = resolve;
        }),
    );

    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const first = renderHook(() => useRedeploySupabaseFunctions(7), {
      wrapper,
    });
    let redeployPromise: Promise<unknown>;
    act(() => {
      redeployPromise = first.result.current.redeployAllFunctions();
    });
    await waitFor(() =>
      expect(first.result.current.isRedeployingFunctions).toBe(true),
    );

    first.unmount();
    const remounted = renderHook(() => useRedeploySupabaseFunctions(7), {
      wrapper,
    });
    expect(remounted.result.current.isRedeployingFunctions).toBe(true);

    const operationId = mocks.redeployAllFunctions.mock.calls[0][0].operationId;
    act(() => {
      for (const listener of mocks.progressListeners) {
        listener({ appId: 7, operationId, completed: 1, total: 2 });
      }
    });
    expect(remounted.result.current.redeployProgress).toMatchObject({
      operationId,
      completed: 1,
      total: 2,
    });

    finishRedeploy({
      functionCount: 1,
      prunedFunctionNames: [],
      errors: [],
    });
    await act(async () => {
      await redeployPromise!;
    });
    await waitFor(() =>
      expect(remounted.result.current.isRedeployingFunctions).toBe(false),
    );
  });
});
