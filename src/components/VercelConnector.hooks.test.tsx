import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVercelTokenSetup } from "./VercelConnector.hooks";

const mocks = vi.hoisted(() => ({
  refreshSettings: vi.fn(),
  saveToken: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    vercel: {
      saveToken: mocks.saveToken,
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
});
