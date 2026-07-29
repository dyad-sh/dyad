import { createStore, Provider } from "jotai";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import capturedSessionFixture from "./fixtures/chat-tab-session.real.json";
import { ChatTabs } from "@/components/chat/ChatTabs";
import {
  chatTabSessionStorageAtom,
  closedChatIdsAtom,
  hydrateChatTabSessionAtom,
  recentViewedChatIdsAtom,
  sessionOpenedChatIdsAtom,
  type ChatTabSession,
} from "@/atoms/chatAtoms";

const capturedSession = capturedSessionFixture as ChatTabSession;

const mocks = vi.hoisted(() => ({
  selectChat: vi.fn(),
  router: {
    subscribe: vi.fn(() => vi.fn()),
  },
}));

vi.mock("@/hooks/useChats", () => ({
  useChats: () => ({
    loading: false,
    chats: [1711, 1736, 1764, 1799, 1807, 1842].map((id) => ({
      id,
      appId: id === 1807 ? 7 : 8,
      title: `Chat ${id}`,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      chatMode: null,
      isFavorite: false,
    })),
  }),
}));

vi.mock("@/hooks/useLoadApps", () => ({
  useLoadApps: () => ({
    apps: [
      { id: 7, name: "Golden app" },
      { id: 8, name: "Other app" },
    ],
  }),
}));

vi.mock("@/hooks/useSelectChat", () => ({
  useSelectChat: () => ({ selectChat: mocks.selectChat }),
}));

vi.mock("@/hooks/useReopenClosedTab", () => ({
  useReopenClosedTab: () => ({
    reopenClosedTab: vi.fn(),
    hasClosedTabs: false,
    lastClosedTab: null,
  }),
}));

vi.mock("@/hooks/useChatModeToggle", () => ({
  useIsMac: () => false,
}));

vi.mock("@/chat_stream/ChatStreamProvider", () => ({
  useStreamFinished: vi.fn(),
}));

vi.mock("@/hooks/useChatStream", () => ({
  useChatStreamState: () => undefined,
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { enableMultiWindow: false },
  }),
}));

vi.mock("@/preview_iframe/PreviewIframeProvider", () => ({
  usePreviewIframeManager: () => ({
    getSnapshot: vi.fn(),
    send: vi.fn(),
  }),
}));

vi.mock("@/ipc/types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ipc/types")>();
  return {
    ...actual,
    ipc: {
      ...actual.ipc,
      windowInfrastructure: {
        ...actual.ipc.windowInfrastructure,
        setChatTabOwnership: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => mocks.router,
  useRouterState: ({ select }: { select: (state: any) => unknown }) =>
    select({ location: { pathname: "/", href: "/" } }),
}));

describe("golden single-window: tab-session schema", () => {
  it("restores the tabs and selection from a captured real session blob", () => {
    const store = createStore();
    store.set(chatTabSessionStorageAtom, capturedSession);

    const restored = store.set(
      hydrateChatTabSessionAtom,
      new Set([1711, 1736, 1764, 1799, 1807, 1842]),
    );

    // Protects the Phase B per-window tab-session schema migration.
    expect(restored).toEqual(capturedSession);
    expect(store.get(recentViewedChatIdsAtom)).toEqual([
      1842, 1799, 1807, 1764,
    ]);
    expect(Array.from(store.get(sessionOpenedChatIdsAtom))).toEqual([
      1842, 1799, 1807, 1764,
    ]);
    expect(Array.from(store.get(closedChatIdsAtom))).toEqual([1711, 1736]);
  });

  it("applies the captured selection through the production tab component", async () => {
    const store = createStore();
    store.set(chatTabSessionStorageAtom, capturedSession);

    const view = render(
      <Provider store={store}>
        <ChatTabs selectedChatId={null} />
      </Provider>,
    );

    // Protects selection application in the Phase B per-window tab migration.
    await waitFor(() =>
      expect(mocks.selectChat).toHaveBeenCalledExactlyOnceWith({
        chatId: 1807,
        appId: 7,
        preserveTabOrder: true,
      }),
    );
    expect(store.get(recentViewedChatIdsAtom)).toEqual([
      1842, 1799, 1807, 1764,
    ]);
    view.unmount();
  });
});
