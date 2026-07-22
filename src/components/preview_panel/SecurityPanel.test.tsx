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
        fixChatId: undefined as number | undefined,
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
    handleSwitchedToMainBranch: vi.fn(),
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

vi.mock("@/hooks/useSwitchedToMainBranch", () => ({
  useSwitchedToMainBranch: () => mocks.handleSwitchedToMainBranch,
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
    mocks.createChat.mockResolvedValue(99);
    mocks.editAppFile.mockResolvedValue({});
    mocks.handleSwitchedToMainBranch.mockResolvedValue(undefined);
    mocks.reviewData.findings[0].fixChatId = undefined;
  });

  it("keeps selected findings until a newly-created bulk fix stream settles", async () => {
    let settle:
      | ((result: { success: boolean; pausedByStepLimit?: boolean }) => void)
      | undefined;
    mocks.streamMessage.mockImplementation(async ({ onSettled }) => {
      settle = onSettled;
    });

    const { rerender } = render(<SecurityPanel />);

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select SQL injection" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select XSS" }));
    fireEvent.click(screen.getByRole("button", { name: "Fix 2 issues" }));

    await waitFor(() => {
      expect(mocks.streamMessage).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByRole("button", { name: /Fixing all issues/ }),
    ).toBeTruthy();

    // Persisting the fix-chat mapping refetches the same review with new
    // metadata. That must not look like a new review and clear the selection.
    mocks.reviewData = { ...mocks.reviewData };
    rerender(<SecurityPanel />);
    expect(
      screen.getByRole("button", { name: /Fixing all issues/ }),
    ).toBeTruthy();

    act(() => {
      settle?.({ success: true });
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Fixing all issues/ }),
      ).toBeNull();
    });
    expect(
      screen.getByRole("button", { name: "Show fix for all issues" }),
    ).toBeTruthy();
  });

  it("shows a reused all-issues fix chat and offers re-run from its dropdown", async () => {
    mocks.getOrCreateSecurityFixChat.mockResolvedValue({
      chatId: 84,
      created: false,
    });
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
    fireEvent.click(screen.getByRole("button", { name: "Fix 2 issues" }));

    expect(
      await screen.findByRole("button", {
        name: "Show fix for all issues",
      }),
    ).toBeTruthy();
    expect(mocks.streamMessage).not.toHaveBeenCalled();
    expect(mocks.selectChat).toHaveBeenLastCalledWith({ chatId: 84, appId: 1 });
    expect(
      screen.getByRole("button", { name: "Run review" }).className,
    ).toContain("bg-primary");

    fireEvent.click(
      screen.getByRole("button", { name: "Show fix for all issues" }),
    );
    expect(mocks.toastInfo).toHaveBeenCalledWith("Opened fix chat");

    fireEvent.click(
      screen.getByRole("button", {
        name: "More fix actions for all issues",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Re-run fix" }),
    );

    await waitFor(() => {
      expect(mocks.streamMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: 84,
          appId: 1,
          prompt: expect.stringContaining("2 security issues"),
        }),
      );
    });
    expect(
      screen.getByRole("button", { name: /Fixing all issues/ }),
    ).toBeTruthy();

    act(() => {
      settle?.({ success: true });
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Show fix for all issues" }),
      ).toBeTruthy();
    });
  });

  it("uses the reused subset scope while a bulk fix is re-running", async () => {
    mocks.getOrCreateSecurityFixChat.mockResolvedValue({
      chatId: 85,
      created: false,
    });
    mocks.streamMessage.mockImplementation(async () => {});

    render(<SecurityPanel />);

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select SQL injection" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Fix 1 issue" }));

    expect(
      await screen.findByRole("button", { name: "Show fix for 1 issue" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "More fix actions for 1 issue" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Re-run fix" }),
    );

    expect(
      await screen.findByRole("button", { name: "Fixing 1 issue..." }),
    ).toBeTruthy();
  });

  it("offers to fix all findings when none are selected", async () => {
    render(<SecurityPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Fix all issues" }));

    await waitFor(() => {
      expect(mocks.getOrCreateSecurityFixChat).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 1,
          reviewChatId: 7,
          findings: mocks.reviewData.findings,
        }),
      );
    });
    await waitFor(() => {
      expect(mocks.streamMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining("2 security issues"),
        }),
      );
    });
  });

  it("disables fixes from stale review data while a new review is running", async () => {
    mocks.streamMessage.mockImplementation(async () => {});

    render(<SecurityPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Run review" }));

    await screen.findByRole("button", { name: "Running review..." });
    expect(
      (
        screen.getByRole("button", {
          name: "Fix all issues",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(mocks.getOrCreateSecurityFixChat).not.toHaveBeenCalled();
  });

  it("shows an existing fix and offers re-run from its overflow menu", async () => {
    mocks.reviewData.findings[0].fixChatId = 42;
    let settle:
      | ((result: { success: boolean; pausedByStepLimit?: boolean }) => void)
      | undefined;
    mocks.streamMessage.mockImplementation(async ({ onSettled }) => {
      settle = onSettled;
    });

    render(<SecurityPanel />);

    expect(screen.getByRole("button", { name: "Show fix" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Fix Issue" })).toHaveLength(
      1,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show fix" }));
    expect(mocks.setIsChatPanelHidden).toHaveBeenLastCalledWith(false);
    expect(mocks.selectChat).toHaveBeenLastCalledWith({ chatId: 42, appId: 1 });
    expect(mocks.toastInfo).toHaveBeenCalledWith("Opened fix chat");
    expect(mocks.getOrCreateSecurityFixChat).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "More fix actions for SQL injection",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Re-run fix" }),
    );

    await waitFor(() => {
      expect(mocks.streamMessage).toHaveBeenCalledTimes(1);
    });
    expect(mocks.setIsChatPanelHidden).toHaveBeenLastCalledWith(false);
    expect(mocks.selectChat).toHaveBeenLastCalledWith({ chatId: 42, appId: 1 });
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
