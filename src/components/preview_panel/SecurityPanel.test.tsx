import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SecurityPanel } from "./SecurityPanel";

const mocks = vi.hoisted(() => {
  const reviewData = {
    findings: [
      {
        title: "SQL injection",
        level: "high",
        description: "User input reaches a query.",
      },
      {
        title: "XSS",
        level: "medium",
        description: "User content is rendered without escaping.",
      },
    ],
    timestamp: "2026-07-07T00:00:00.000Z",
    chatId: 7,
  };

  return {
    reviewData,
    getOrCreateSecurityFixChat: vi.fn(),
    streamMessage: vi.fn(),
    selectChat: vi.fn(),
    setIsChatPanelHidden: vi.fn(),
    invalidateQueries: vi.fn(),
    refetchSecurityReview: vi.fn(),
    refreshFile: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showWarning: vi.fn(),
    toastInfo: vi.fn(),
    openExternalUrl: vi.fn(),
    editAppFile: vi.fn(),
    createChat: vi.fn(),
  };
});

vi.mock("jotai", () => ({
  atom: (initialValue: unknown) => ({ initialValue }),
  useAtomValue: () => 1,
  useSetAtom: () => mocks.setIsChatPanelHidden,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}));

vi.mock("@/hooks/useSecurityReview", () => ({
  useSecurityReview: () => ({
    data: mocks.reviewData,
    isLoading: false,
    error: null,
    refetch: mocks.refetchSecurityReview,
  }),
}));

vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({
    streamMessage: mocks.streamMessage,
  }),
}));

vi.mock("@/hooks/useSelectChat", () => ({
  useSelectChat: () => ({
    selectChat: mocks.selectChat,
  }),
}));

vi.mock("@/hooks/useLoadAppFile", () => ({
  useLoadAppFile: () => ({
    content: null,
    loading: false,
    refreshFile: mocks.refreshFile,
  }),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    app: {
      editAppFile: mocks.editAppFile,
    },
    chat: {
      createChat: mocks.createChat,
    },
    security: {
      getOrCreateSecurityFixChat: mocks.getOrCreateSecurityFixChat,
    },
    system: {
      openExternalUrl: mocks.openExternalUrl,
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  showError: mocks.showError,
  showSuccess: mocks.showSuccess,
  showWarning: mocks.showWarning,
  toast: {
    info: mocks.toastInfo,
  },
}));

vi.mock("@/components/chat/DyadMarkdownParser", () => ({
  VanillaMarkdownParser: ({ content }: { content: string }) => (
    <span>{content}</span>
  ),
}));

describe("SecurityPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrCreateSecurityFixChat.mockResolvedValue({
      chatId: 42,
      created: true,
    });
    mocks.streamMessage.mockResolvedValue(undefined);
  });

  it("keeps selected findings until a newly-created bulk fix stream settles", async () => {
    let settle:
      | ((result: { success: boolean; pausedByStepLimit?: boolean }) => void)
      | undefined;
    mocks.streamMessage.mockImplementation(async ({ onSettled }) => {
      settle = onSettled;
    });

    render(<SecurityPanel />);

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select SQL injection" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select XSS" }));
    fireEvent.click(screen.getByRole("button", { name: "Fix 2 Issues" }));

    await waitFor(() => {
      expect(mocks.streamMessage).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByRole("button", { name: /Fixing 2 Issues/ }),
    ).toBeTruthy();

    act(() => {
      settle?.({ success: true });
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Fixing 2 Issues/ }),
      ).toBeNull();
    });
    expect(screen.queryByRole("button", { name: "Fix 2 Issues" })).toBeNull();
  });

  it("navigates before toast re-runs and ignores duplicate clicks while the re-run streams", async () => {
    mocks.getOrCreateSecurityFixChat.mockResolvedValue({
      chatId: 42,
      created: false,
    });
    let settle:
      | ((result: { success: boolean; pausedByStepLimit?: boolean }) => void)
      | undefined;
    mocks.streamMessage.mockImplementation(async ({ onSettled }) => {
      settle = onSettled;
    });

    render(<SecurityPanel />);

    fireEvent.click(screen.getAllByRole("button", { name: "Fix Issue" })[0]);
    await waitFor(() => {
      expect(mocks.toastInfo).toHaveBeenCalledTimes(1);
    });

    const toastOptions = mocks.toastInfo.mock.calls[0][1];
    act(() => {
      toastOptions.action.onClick();
    });

    await waitFor(() => {
      expect(mocks.streamMessage).toHaveBeenCalledTimes(1);
    });
    expect(mocks.setIsChatPanelHidden).toHaveBeenLastCalledWith(false);
    expect(mocks.selectChat).toHaveBeenLastCalledWith({ chatId: 42, appId: 1 });
    expect(
      screen.getByRole("button", { name: "Fixing Issue..." }),
    ).toBeTruthy();

    act(() => {
      toastOptions.action.onClick();
    });

    expect(mocks.streamMessage).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Fixing Issue..." }),
    ).toBeTruthy();

    act(() => {
      settle?.({ success: true });
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Fixing Issue..." }),
      ).toBeNull();
    });
  });
});
