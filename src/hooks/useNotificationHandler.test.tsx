import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useNotificationHandler } from "./useNotificationHandler";

const mocks = vi.hoisted(() => ({
  completionListener: undefined as
    | ((event: {
        chatId: number;
        outcome: "completed" | "cancelled" | "errored";
        chatSummary?: string;
      }) => void)
    | undefined,
  resolveAppNameForAppId: vi.fn(),
  resolveChatSummary: vi.fn(),
}));

vi.mock("@/chat_stream/ChatStreamProvider", () => ({
  useStreamFinished: (
    listener: NonNullable<typeof mocks.completionListener>,
  ) => {
    mocks.completionListener = listener;
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
}));

vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtomValue: () => new Map(),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => ({
    location: { pathname: "/", search: {} },
  }),
}));

vi.mock("./useSelectChat", () => ({
  useSelectChat: () => ({ selectChat: vi.fn() }),
}));

vi.mock("./useSettings", () => ({
  useSettings: () => ({
    settings: { enableChatEventNotifications: true },
  }),
}));

vi.mock("../ipc/types", () => ({
  ipc: {
    events: {
      userInput: {
        onRequested: () => vi.fn(),
        onClassified: () => vi.fn(),
        onSettled: () => vi.fn(),
      },
    },
    system: {
      focusWindow: () => Promise.resolve(),
    },
  },
}));

vi.mock("../lib/chatUtils", () => ({
  resolveAppIdForChat: vi.fn(),
  resolveAppNameForAppId: mocks.resolveAppNameForAppId,
  resolveChatSummary: mocks.resolveChatSummary,
}));

vi.mock("../lib/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/toast")>()),
  showError: vi.fn(),
  showWarning: vi.fn(),
}));

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(() =>
    Promise.resolve<NotificationPermission>("granted"),
  );
  static instances: FakeNotification[] = [];

  onclose: (() => void) | null = null;
  onclick: (() => void) | null = null;
  close = vi.fn();

  constructor(
    readonly title: string,
    readonly options?: NotificationOptions,
  ) {
    FakeNotification.instances.push(this);
  }
}

describe("useNotificationHandler", () => {
  beforeEach(() => {
    mocks.completionListener = undefined;
    mocks.resolveChatSummary.mockReset();
    mocks.resolveAppNameForAppId.mockReset();
    mocks.resolveChatSummary.mockResolvedValue({
      appId: 7,
      title: "Fallback title",
    });
    mocks.resolveAppNameForAppId.mockResolvedValue("Notes");
    FakeNotification.instances = [];
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: FakeNotification,
    });
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
  });

  it("notifies only completed stream events and uses the streamed summary", async () => {
    const { unmount } = renderHook(() => useNotificationHandler());
    expect(mocks.completionListener).toBeDefined();

    act(() => {
      mocks.completionListener?.({
        chatId: 42,
        outcome: "cancelled",
        chatSummary: "Cancelled summary",
      });
      mocks.completionListener?.({
        chatId: 42,
        outcome: "completed",
        chatSummary: "Built a notes app",
      });
    });

    await waitFor(() => expect(FakeNotification.instances).toHaveLength(1));
    expect(FakeNotification.instances[0]).toMatchObject({
      title: "Notes",
      options: {
        body: "Built a notes app",
        tag: "dyad-chat-complete-42",
      },
    });

    unmount();
  });
});
