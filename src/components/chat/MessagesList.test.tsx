import { Provider, createStore } from "jotai";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { OptimisticChatMessages } from "@/chat_stream/optimistic_messages";
import { MessagesList } from "./MessagesList";

const state = vi.hoisted(() => ({
  manager: {} as { optimisticMessages: OptimisticChatMessages },
}));
vi.mock("@/chat_stream/ChatStreamProvider", () => ({
  useChatStreamManager: () => state.manager,
}));
vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({ isStreaming: true, streamMessage: vi.fn() }),
}));
vi.mock("@/hooks/useVersions", () => ({
  useVersions: () => ({ refreshVersions: vi.fn() }),
}));
vi.mock("@/hooks/useVersionPreview", () => ({
  useVersionPreview: () => ({
    state: { type: "idle" },
    projection: { capabilities: { canRestore: false } },
    sendAndWaitForMutation: vi.fn(),
  }),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: { isTestMode: true } }),
}));
vi.mock("@/hooks/useChatMode", () => ({ useChatMode: () => ({ chat: null }) }));
vi.mock("@/hooks/useLanguageModelProviders", () => ({
  useLanguageModelProviders: () => ({
    isAnyProviderSetup: () => true,
    isProviderSetup: () => true,
  }),
}));
vi.mock("@/user_input/hooks", () => ({
  useUserInputRequests: () => new Map(),
}));
vi.mock("./ChatMessage", () => ({
  default: ({ message }: { message: { content: string } }) => (
    <div>{message.content}</div>
  ),
}));
vi.mock("./ModifiedFilesCard", () => ({ ModifiedFilesCard: () => null }));
vi.mock("./ExtraCommitsRevertDialog", () => ({
  ExtraCommitsRevertDialog: () => null,
}));
vi.mock("../SetupBanner", () => ({
  SetupBanner: () => null,
  OpenRouterSetupBanner: () => null,
}));

it("uses the rendered chat during navigation before global selection catches up", () => {
  const store = createStore();
  store.set(selectedChatIdAtom, 1);
  const optimisticMessages = new OptimisticChatMessages();
  state.manager = { optimisticMessages };
  optimisticMessages.add("pending-a", { chatId: 1, prompt: "Pending in A" });
  const view = render(
    <Provider store={store}>
      <MessagesList chatId={1} messages={[]} />
    </Provider>,
  );
  expect(screen.getByText("Pending in A")).toBeTruthy();
  view.rerender(
    <Provider store={store}>
      <MessagesList
        chatId={2}
        messages={[{ id: 20, role: "user", content: "History in B" }]}
      />
    </Provider>,
  );
  expect(store.get(selectedChatIdAtom)).toBe(1);
  expect(screen.getByText("History in B")).toBeTruthy();
  expect(screen.queryByText("Pending in A")).toBeNull();
  view.rerender(
    <Provider store={store}>
      <MessagesList chatId={1} messages={[]} />
    </Provider>,
  );
  expect(screen.getByText("Pending in A")).toBeTruthy();
  view.unmount();
  optimisticMessages.dispose();
});
