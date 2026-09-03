import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useIntegrationContinue } from "./useIntegrationContinue";

const mocks = vi.hoisted(() => ({
  posthogCapture: vi.fn(),
  respond: vi.fn(),
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mocks.posthogCapture }),
}));

vi.mock("@/user_input/read_model", () => ({
  getUserInputReadModel: () => ({ respond: mocks.respond }),
}));

vi.mock("@/user_input/hooks", () => ({
  usePendingIntegrations: () =>
    new Map([
      [
        7,
        {
          requestId: "integration-1",
          chatId: 7,
          provider: "neon",
        },
      ],
    ]),
  useRespondingRequestIds: () => new Set<string>(),
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({
    app: { neonProjectId: "neon-project-1" },
    loading: false,
  }),
}));

function makeWrapper() {
  const store = createStore();
  store.set(selectedAppIdAtom, 1);
  store.set(selectedChatIdAtom, 7);

  return function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  };
}

describe("useIntegrationContinue", () => {
  beforeEach(() => {
    mocks.posthogCapture.mockReset();
    mocks.respond.mockReset();
    mocks.respond.mockResolvedValue(true);
  });

  it("tracks completion after the connected provider is confirmed", async () => {
    const { result } = renderHook(() => useIntegrationContinue(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.canContinue).toBe(true);
    await act(async () => {
      await result.current.handleContinue();
    });

    expect(mocks.respond).toHaveBeenCalledWith("integration-1", {
      kind: "integration",
      provider: "neon",
      completed: true,
    });
    expect(mocks.posthogCapture.mock.calls).toEqual([
      [
        "integration-setup:start",
        { provider: "neon", requestId: "integration-1" },
      ],
      [
        "integration-setup:complete",
        { provider: "neon", requestId: "integration-1" },
      ],
    ]);
  });

  it("does not track completion when the response is rejected", async () => {
    mocks.respond.mockResolvedValue(false);
    const { result } = renderHook(() => useIntegrationContinue(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.handleContinue();
    });

    expect(mocks.posthogCapture).not.toHaveBeenCalled();
  });
});
