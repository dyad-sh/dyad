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
  requestedListener: undefined as ((descriptor: unknown) => void) | undefined,
  settledListener: undefined as
    | ((event: { requestId: string; outcome: string }) => void)
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

vi.mock("./useSettings", () => ({
  useSettings: () => ({
    settings: { enableChatEventNotifications: true },
  }),
}));

vi.mock("../ipc/types", () => ({
  ipc: {
    events: {
      userInput: {
        onRequested: (listener: (descriptor: unknown) => void) => {
          mocks.requestedListener = listener;
          return vi.fn();
        },
        onClassified: () => vi.fn(),
        onSettled: (
          listener: (event: { requestId: string; outcome: string }) => void,
        ) => {
          mocks.settledListener = listener;
          return vi.fn();
        },
      },
    },
    windowInfrastructure: {
      focusChat: () =>
        Promise.resolve({
          windowSessionId: "10000000-0000-4000-8000-000000000001",
        }),
    },
  },
}));

vi.mock("../lib/chatUtils", () => ({
  resolveAppNameForAppId: mocks.resolveAppNameForAppId,
  resolveChatSummary: mocks.resolveChatSummary,
}));

vi.mock("../lib/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/toast")>()),
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
    mocks.requestedListener = undefined;
    mocks.settledListener = undefined;
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

  it("notifies when the agent parks on a plugin suggestion", async () => {
    const { unmount } = renderHook(() => useNotificationHandler());
    expect(mocks.requestedListener).toBeDefined();

    act(() => {
      mocks.requestedListener?.({
        kind: "plugin-suggestion",
        requestId: "plugin-suggestion:1",
        chatId: 42,
        deadlineAt: 0,
        slug: "vercel",
        serverName: "Vercel",
        needsOAuth: true,
        reason: "Read the build logs.",
        classifier: "none",
        followUpPrompt: "Continue.",
      });
    });

    await waitFor(() => expect(FakeNotification.instances).toHaveLength(1));
    const notification = FakeNotification.instances[0];
    expect(notification).toMatchObject({
      title: "Notes",
      options: {
        body: "Dyad wants to connect the Vercel plugin. Click to review.",
        tag: "dyad-plugin-suggestion-plugin-suggestion:1",
        // Blocks the turn until answered, so it must not auto-dismiss.
        requireInteraction: true,
      },
    });

    // Answering the card in the app closes the OS notification.
    act(() => {
      mocks.settledListener?.({
        requestId: "plugin-suggestion:1",
        outcome: "human",
      });
    });
    expect(notification.close).toHaveBeenCalled();

    unmount();
  });
});
