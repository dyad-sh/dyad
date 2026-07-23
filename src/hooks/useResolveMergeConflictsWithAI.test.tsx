import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import type { StreamEvent } from "@/chat_stream/state";

import { useResolveMergeConflictsWithAI } from "./useResolveMergeConflictsWithAI";

const APP_ID = 7;
const CHAT_ID = 42;

const mocks = vi.hoisted(() => ({
  createChat: vi.fn(),
  controllerSend: vi.fn(),
  invalidateChats: vi.fn(),
  navigate: vi.fn(),
  onStartResolving: vi.fn(),
  refreshApp: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: { chat: { createChat: mocks.createChat } },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/chat_stream/ChatStreamProvider", () => ({
  useChatStreamManager: () => ({
    ensure: () => ({ send: mocks.controllerSend }),
  }),
}));

vi.mock("@/hooks/useChats", () => ({
  useChats: () => ({ invalidateChats: mocks.invalidateChats }),
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({ refreshApp: mocks.refreshApp }),
}));

vi.mock("@/lib/toast", () => ({ showError: mocks.showError }));

function makeWrapper() {
  const store = createStore();
  const Wrapper = ({ children }: PropsWithChildren) => (
    <Provider store={store}>{children}</Provider>
  );
  return { store, Wrapper };
}

describe("useResolveMergeConflictsWithAI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createChat.mockResolvedValue(CHAT_ID);
    mocks.refreshApp.mockResolvedValue(undefined);
  });

  it("creates and selects a chat, then submits conflict resolution through the stream machine", async () => {
    const { store, Wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useResolveMergeConflictsWithAI({
          appId: APP_ID,
          conflicts: ["src/one.ts", "src/two.ts"],
          onStartResolving: mocks.onStartResolving,
        }),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await result.current.resolveWithAI();
    });

    expect(mocks.createChat).toHaveBeenCalledExactlyOnceWith({
      appId: APP_ID,
      initialChatMode: "build",
    });
    expect(mocks.onStartResolving).toHaveBeenCalledOnce();
    expect(store.get(selectedChatIdAtom)).toBe(CHAT_ID);
    expect(store.get(selectedAppIdAtom)).toBe(APP_ID);
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/chat",
      search: { id: CHAT_ID },
    });

    const event = mocks.controllerSend.mock.calls[0][0] as StreamEvent;
    expect(event).toMatchObject({
      type: "submit",
      request: {
        chatId: CHAT_ID,
        appId: APP_ID,
      },
    });
    expect(event.type === "submit" && event.request.prompt).toContain(
      "- src/one.ts\n- src/two.ts",
    );
    expect(result.current.isResolving).toBe(true);

    await act(async () => {
      if (event.type === "submit") {
        event.request.onSettled?.({ success: false });
      }
    });

    expect(result.current.isResolving).toBe(false);
    expect(mocks.invalidateChats).toHaveBeenCalledOnce();
    expect(mocks.refreshApp).toHaveBeenCalledOnce();
  });

  it("blocks reentrant creation and clears resolving when chat creation fails", async () => {
    let rejectCreate!: (error: Error) => void;
    mocks.createChat.mockReturnValue(
      new Promise<number>((_resolve, reject) => {
        rejectCreate = reject;
      }),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useResolveMergeConflictsWithAI({
          appId: APP_ID,
          conflicts: ["src/one.ts"],
        }),
      { wrapper: Wrapper },
    );

    let firstAttempt!: Promise<void>;
    await act(async () => {
      firstAttempt = result.current.resolveWithAI();
      void result.current.resolveWithAI();
      await Promise.resolve();
    });

    expect(result.current.isResolving).toBe(true);
    expect(mocks.createChat).toHaveBeenCalledOnce();

    await act(async () => {
      rejectCreate(new Error("create failed"));
      await firstAttempt;
    });

    expect(result.current.isResolving).toBe(false);
    expect(mocks.showError).toHaveBeenCalledExactlyOnceWith("create failed");
    expect(mocks.controllerSend).not.toHaveBeenCalled();
  });

  it("uses conflicts supplied by the machine runner instead of the render closure", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useResolveMergeConflictsWithAI({
          appId: APP_ID,
          conflicts: [],
        }),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await result.current.resolveFilesWithAI(["src/from-machine.ts"]);
    });

    const event = mocks.controllerSend.mock.calls[0][0] as StreamEvent;
    expect(event.type === "submit" && event.request.prompt).toContain(
      "- src/from-machine.ts",
    );
    expect(mocks.showError).not.toHaveBeenCalled();
  });
});
