import { QueryClient } from "@tanstack/react-query";
import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeCheckoutCounterAtom } from "@/store/appAtoms";
import { chatMessagesByIdAtom } from "@/atoms/chatAtoms";
import type { VersionCommandResult } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { createVersionPreviewRuntime } from "./commands";

const {
  checkoutVersionMock,
  revertVersionMock,
  restoreToMessageVersionMock,
  getChatMock,
  restartAppMock,
  toastSuccessMock,
  toastWarningMock,
} = vi.hoisted(() => ({
  checkoutVersionMock: vi.fn(),
  revertVersionMock: vi.fn(),
  restoreToMessageVersionMock: vi.fn(),
  getChatMock: vi.fn(),
  restartAppMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastWarningMock: vi.fn(),
}));

vi.mock("@/ipc/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/types")>()),
  ipc: {
    chat: { getChat: getChatMock },
    version: {
      checkoutVersion: checkoutVersionMock,
      revertVersion: revertVersionMock,
      restoreToMessageVersion: restoreToMessageVersionMock,
    },
  },
}));

vi.mock("@/lib/toast", () => ({ showError: vi.fn() }));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    warning: toastWarningMock,
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}));

const result = (
  overrides: Partial<VersionCommandResult> = {},
): VersionCommandResult => ({
  repositoryOutcome: "target-applied",
  notification: null,
  runtimeAction: "none",
  affectedChatId: null,
  createdChatId: null,
  ...overrides,
});

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const store = createStore();
  const navigateToChat = vi.fn();
  const runtime = createVersionPreviewRuntime({
    queryClient,
    store,
    restartApp: restartAppMock,
    navigateToChat,
  });
  return { queryClient, store, navigateToChat, runtime };
}

describe("createVersionPreviewRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkoutVersionMock.mockResolvedValue(result());
    revertVersionMock.mockResolvedValue(result());
    restoreToMessageVersionMock.mockResolvedValue(result());
    restartAppMock.mockResolvedValue(undefined);
  });

  it("uses semantic preview and return checkout intents", async () => {
    const { runtime, store } = setup();
    await runtime.commands.checkoutVersion({ appId: 7, versionId: "abc" });
    await runtime.commands.returnToBranch({ appId: 7, branch: "feature/x" });
    await runtime.commands.switchBranch({ appId: 7, branch: "main" });

    expect(checkoutVersionMock).toHaveBeenNthCalledWith(1, {
      purpose: "preview",
      appId: 7,
      versionId: "abc",
    });
    expect(checkoutVersionMock).toHaveBeenNthCalledWith(2, {
      purpose: "return",
      appId: 7,
      branch: "feature/x",
    });
    expect(checkoutVersionMock).toHaveBeenNthCalledWith(3, {
      purpose: "return",
      appId: 7,
      branch: "main",
    });
    expect(store.get(activeCheckoutCounterAtom)).toBe(0);
  });

  it("invalidates current and inventory branches for the affected app", async () => {
    const { queryClient, runtime } = setup();
    const current = queryKeys.branches.current({ appId: 7 });
    const inventory = queryKeys.branches.inventory({ appId: 7 });
    const otherInventory = queryKeys.branches.inventory({ appId: 8 });
    queryClient.setQueryData(current, { branch: "main" });
    queryClient.setQueryData(inventory, { branches: ["main"] });
    queryClient.setQueryData(otherInventory, { branches: ["main"] });

    await runtime.commands.checkoutVersion({ appId: 7, versionId: "abc" });

    expect(queryClient.getQueryState(current)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(inventory)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherInventory)?.isInvalidated).toBe(
      false,
    );
  });

  it("applies authoritative chat, navigation, notification, and restart metadata", async () => {
    const commandResult = result({
      notification: { kind: "warning", message: "Database unavailable" },
      runtimeAction: "restart",
      affectedChatId: 11,
      createdChatId: 12,
    });
    restoreToMessageVersionMock.mockResolvedValue(commandResult);
    getChatMock.mockResolvedValue({ messages: [{ id: 1 }] });
    const { runtime, store, navigateToChat } = setup();

    const commandOutcome = await runtime.commands.restoreToMessage({
      appId: 7,
      chatId: 11,
      messageId: 22,
      restoreCodebase: true,
      targetBranch: "feature/x",
    });

    expect(toastWarningMock).toHaveBeenCalledWith("Database unavailable", {
      duration: 8000,
    });
    expect(store.get(chatMessagesByIdAtom).get(11)).toEqual([{ id: 1 }]);
    expect(navigateToChat).toHaveBeenCalledWith({ appId: 7, chatId: 12 });
    expect(restartAppMock).toHaveBeenCalledWith(7);
    expect(commandOutcome.repositoryOutcome).toBe("target-applied");
  });

  it("preserves an authoritative unchanged restore outcome", async () => {
    restoreToMessageVersionMock.mockResolvedValue(
      result({ repositoryOutcome: "unchanged" }),
    );
    const { runtime } = setup();
    await expect(
      runtime.commands.restoreToMessage({
        appId: 7,
        chatId: 11,
        messageId: 22,
        restoreCodebase: false,
        targetBranch: "feature/x",
      }),
    ).resolves.toMatchObject({ repositoryOutcome: "unchanged" });
  });

  it("refreshes the affected chat returned by main, independent of UI selection", async () => {
    revertVersionMock.mockResolvedValue(
      result({
        affectedChatId: 55,
        notification: { kind: "success", message: "Restored" },
      }),
    );
    getChatMock.mockResolvedValue({ messages: [{ id: 9 }] });
    const { runtime, store } = setup();

    await runtime.commands.restoreVersion({
      appId: 7,
      versionId: "abc",
      targetBranch: null,
      expectedHeadOid: "head-at-confirmation",
    });

    expect(revertVersionMock).toHaveBeenCalledWith({
      appId: 7,
      previousVersionId: "abc",
      expectedHeadOid: "head-at-confirmation",
      targetBranchName: undefined,
      currentChatMessageId: undefined,
    });
    expect(getChatMock).toHaveBeenCalledWith(55);
    expect(store.get(chatMessagesByIdAtom).get(55)).toEqual([{ id: 9 }]);
    expect(toastSuccessMock).toHaveBeenCalledWith("Restored");
  });

  it("does not turn a post-effect failure into a Git mutation failure", async () => {
    checkoutVersionMock.mockResolvedValue(result({ runtimeAction: "restart" }));
    restartAppMock.mockRejectedValue(new Error("restart failed"));
    const { runtime } = setup();

    await expect(
      runtime.commands.checkoutVersion({ appId: 7, versionId: "abc" }),
    ).resolves.toBeUndefined();
    expect(toastWarningMock).toHaveBeenCalledWith(
      expect.stringContaining("operation completed"),
    );
  });
});
