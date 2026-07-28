import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNotificationHandler } from "@/hooks/useNotificationHandler";

const mocks = vi.hoisted(() => ({
  classifiedListener: undefined as
    | ((event: { requestId: string }) => void)
    | undefined,
  completionListener: undefined as
    | ((event: {
        chatId: number;
        outcome: "completed" | "cancelled" | "errored";
        chatSummary?: string;
      }) => void)
    | undefined,
  requestedListener: undefined as ((event: any) => void) | undefined,
  settledListener: undefined as
    | ((event: { requestId: string }) => void)
    | undefined,
  focusChat: vi.fn(),
  resolveAppNameForAppId: vi.fn(),
  resolveChatSummary: vi.fn(),
  showWarning: vi.fn(),
}));

vi.mock("@/chat_stream/ChatStreamProvider", () => ({
  useStreamFinished: (
    listener: NonNullable<typeof mocks.completionListener>,
  ) => {
    mocks.completionListener = listener;
  },
}));

vi.mock("@/user_input/hooks", () => ({
  useUserInputRequests: () => new Map(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => ({ location: { pathname: "/", search: {} } }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { enableChatEventNotifications: true },
  }),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    events: {
      userInput: {
        onRequested: (listener: typeof mocks.requestedListener) => {
          mocks.requestedListener = listener;
          return vi.fn();
        },
        onClassified: (listener: typeof mocks.classifiedListener) => {
          mocks.classifiedListener = listener;
          return vi.fn();
        },
        onSettled: (listener: typeof mocks.settledListener) => {
          mocks.settledListener = listener;
          return vi.fn();
        },
      },
    },
    windowInfrastructure: { focusChat: mocks.focusChat },
  },
}));

vi.mock("@/lib/chatUtils", () => ({
  resolveAppNameForAppId: mocks.resolveAppNameForAppId,
  resolveChatSummary: mocks.resolveChatSummary,
}));

vi.mock("@/lib/toast", () => ({
  showWarning: mocks.showWarning,
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

describe("golden single-window: notification routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.completionListener = undefined;
    mocks.requestedListener = undefined;
    mocks.resolveChatSummary.mockResolvedValue({
      appId: 7,
      title: "Golden chat",
    });
    mocks.focusChat.mockResolvedValue({
      windowSessionId: "10000000-0000-4000-8000-000000000001",
    });
    mocks.resolveAppNameForAppId.mockResolvedValue("Golden app");
    FakeNotification.instances = [];
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: FakeNotification,
    });
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
  });

  it("delivers one OS notification for one completed stream", async () => {
    const hook = renderHook(() => useNotificationHandler());

    act(() => {
      mocks.completionListener?.({
        chatId: 42,
        outcome: "completed",
        chatSummary: "Finished the requested change",
      });
    });

    // Protects the Phase B presentation router.
    await waitFor(() => expect(FakeNotification.instances).toHaveLength(1));
    expect(FakeNotification.instances[0]).toMatchObject({
      title: "Golden app",
      options: {
        body: "Finished the requested change",
        tag: "dyad-chat-complete-42",
      },
    });
    await act(async () => FakeNotification.instances[0].onclick?.());
    expect(mocks.focusChat).toHaveBeenCalledExactlyOnceWith({ chatId: 42 });
    expect(FakeNotification.instances[0].close).toHaveBeenCalledOnce();
    expect(mocks.showWarning).not.toHaveBeenCalled();
    hook.unmount();
  });

  it.each([
    {
      descriptor: {
        kind: "agent-consent",
        requestId: "agent-consent:1",
        chatId: 42,
        toolName: "write_file",
        deadlineAt: 1_000,
      },
      tag: "dyad-agent-consent-agent-consent:1",
    },
    {
      descriptor: {
        kind: "questionnaire",
        requestId: "questionnaire:1",
        chatId: 42,
        questions: [{ id: "q1", question: "Which style?" }],
        deadlineAt: 1_000,
      },
      tag: "dyad-plan-questionnaire-questionnaire:1",
    },
  ])(
    "delivers one sticky notification for $descriptor.kind",
    async ({ descriptor, tag }) => {
      const hook = renderHook(() => useNotificationHandler());

      act(() => mocks.requestedListener?.(descriptor));

      await waitFor(() => expect(FakeNotification.instances).toHaveLength(1));
      expect(FakeNotification.instances[0].options).toMatchObject({
        tag,
        requireInteraction: true,
      });
      await act(async () => FakeNotification.instances[0].onclick?.());
      expect(mocks.focusChat).toHaveBeenCalledExactlyOnceWith({ chatId: 42 });
      expect(FakeNotification.instances[0].close).toHaveBeenCalledOnce();
      expect(mocks.showWarning).not.toHaveBeenCalled();
      hook.unmount();
    },
  );

  it("waits for racing MCP consent classification before notifying once", async () => {
    const hook = renderHook(() => useNotificationHandler());

    act(() =>
      mocks.requestedListener?.({
        kind: "mcp-consent",
        requestId: "mcp-consent:1",
        chatId: 42,
        toolName: "search",
        serverName: "golden-server",
        classifier: "racing",
        deadlineAt: 1_000,
      }),
    );
    expect(FakeNotification.instances).toHaveLength(0);

    act(() => mocks.classifiedListener?.({ requestId: "mcp-consent:1" }));

    await waitFor(() => expect(FakeNotification.instances).toHaveLength(1));
    expect(FakeNotification.instances[0].options).toMatchObject({
      tag: "dyad-mcp-consent-mcp-consent:1",
      requireInteraction: true,
    });
    hook.unmount();
  });
});
