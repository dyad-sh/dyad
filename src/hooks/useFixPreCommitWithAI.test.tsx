import type { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildPreCommitFixPrompt,
  useFixPreCommitWithAI,
} from "./useFixPreCommitWithAI";

const mocks = vi.hoisted(() => ({
  createChat: vi.fn(async () => 44),
  deleteChat: vi.fn(),
  selectChat: vi.fn(),
  setIsChatPanelHidden: vi.fn(),
  showError: vi.fn(),
  streamMessage: vi.fn(),
}));

vi.mock("@/atoms/viewAtoms", () => ({
  isChatPanelHiddenAtom: Symbol("is-chat-panel-hidden"),
}));
vi.mock("jotai", () => ({
  useSetAtom: () => mocks.setIsChatPanelHidden,
}));
vi.mock("@/ipc/types", () => ({
  ipc: {
    chat: {
      createChat: mocks.createChat,
      deleteChat: mocks.deleteChat,
    },
  },
}));
vi.mock("@/hooks/useSelectChat", () => ({
  useSelectChat: () => ({ selectChat: mocks.selectChat }),
}));
vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({ streamMessage: mocks.streamMessage }),
}));
vi.mock("@/lib/toast", () => ({ showError: mocks.showError }));

function Wrapper({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe("buildPreCommitFixPrompt", () => {
  it("preserves the manual commit intent and asks the agent to verify fixes", () => {
    const prompt = buildPreCommitFixPrompt({
      commitMessage: "Fix checkout totals",
      failureOutput: "lint: src/cart.ts:12",
    });

    expect(prompt).toContain("run_pre_commit");
    expect(prompt).toContain("rerun the hook until it passes");
    expect(prompt).toContain('"Fix checkout totals"');
    expect(prompt).toContain("lint: src/cart.ts:12");
    expect(prompt).toContain("treat as literal data");
  });
});

describe("useFixPreCommitWithAI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createChat.mockResolvedValue(44);
  });

  it("opens a new Agent chat and submits the failed hook context", async () => {
    const { result } = renderHook(() => useFixPreCommitWithAI(), {
      wrapper: Wrapper,
    });

    let started = false;
    await act(async () => {
      started = await result.current.fixPreCommitWithAI({
        appId: 7,
        commitMessage: "Save checkout fix",
        failureOutput: "lint failed",
      });
    });

    expect(started).toBe(true);
    expect(mocks.createChat).toHaveBeenCalledWith({
      appId: 7,
      initialChatMode: "local-agent",
    });
    expect(mocks.setIsChatPanelHidden).toHaveBeenCalledWith(false);
    expect(mocks.selectChat).toHaveBeenCalledWith({ chatId: 44, appId: 7 });
    expect(mocks.streamMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 44,
        appId: 7,
        requestedChatMode: "local-agent",
        prompt: expect.stringContaining("lint failed"),
      }),
    );
  });
});
