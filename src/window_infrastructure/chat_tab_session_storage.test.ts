import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "jotai";
import capturedSessionFixture from "@/__tests__/golden_single_window/fixtures/chat-tab-session.real.json";
import {
  chatTabSessionStorageAtom,
  initializeChatTabSessionStorageAtom,
  type ChatTabSession,
} from "@/atoms/chatAtoms";
import {
  activeStoredChatTabInstanceState,
  LEGACY_CHAT_TAB_SESSION_STORAGE_KEY,
  LEGACY_CHAT_TAB_SESSION_MIGRATION_KEY,
  adoptStoredChatTab,
  clearSourceChatTabRemoval,
  chatTabSessionStorageKey,
  configureChatTabWindowSession,
  createChatTabSessionStorage,
  hasSourceChatTabRemoval,
  markSourceChatTabRemoval,
  pruneChatTabWindowSessions,
  removeActiveStoredChatTab,
  type StoredWindowChatTabSession,
} from "./chat_tab_session_storage";
import type { TabInstanceId, WindowSessionId } from "./types";

const firstWindow = "10000000-0000-4000-8000-000000000001" as WindowSessionId;
const secondWindow = "20000000-0000-4000-8000-000000000002" as WindowSessionId;

describe("per-window chat tab session storage", () => {
  beforeEach(() => {
    localStorage.clear();
    configureChatTabWindowSession(firstWindow, {
      mayMigrateLegacySession: true,
    });
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("30000000-0000-4000-8000-000000000003")
      .mockReturnValueOnce("40000000-0000-4000-8000-000000000004")
      .mockReturnValue("50000000-0000-4000-8000-000000000005");
  });

  it("migrates the captured legacy blob without deleting the old key", () => {
    localStorage.setItem(
      LEGACY_CHAT_TAB_SESSION_STORAGE_KEY,
      JSON.stringify(capturedSessionFixture),
    );
    const storage = createChatTabSessionStorage(localStorage);

    expect(
      storage.getItem(
        LEGACY_CHAT_TAB_SESSION_STORAGE_KEY,
        capturedSessionFixture as ChatTabSession,
      ),
    ).toEqual(capturedSessionFixture);

    expect(
      localStorage.getItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY),
    ).toBeTruthy();
    expect(localStorage.getItem(LEGACY_CHAT_TAB_SESSION_MIGRATION_KEY)).toBe(
      firstWindow,
    );
    const migrated = JSON.parse(
      localStorage.getItem(chatTabSessionStorageKey(firstWindow))!,
    ) as StoredWindowChatTabSession;
    expect(migrated.version).toBe(2);
    expect(migrated.windowSessionId).toBe(firstWindow);
    expect(migrated.tabs.map((tab) => tab.chatId)).toEqual(
      capturedSessionFixture.openChatIds,
    );
    expect(migrated.tabs.every((tab) => tab.tabInstanceId)).toBe(true);
  });

  it("keeps independent session keys and stable tab instance identities", () => {
    const storage = createChatTabSessionStorage(localStorage);
    const first: ChatTabSession = {
      openChatIds: [10, 20],
      selectedChatId: 20,
      closedChatIds: [30],
      updatedAt: 1,
    };
    storage.setItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY, first);
    const firstEnvelope = JSON.parse(
      localStorage.getItem(chatTabSessionStorageKey(firstWindow))!,
    ) as StoredWindowChatTabSession;
    const firstTabId = firstEnvelope.tabs[0].tabInstanceId;

    storage.setItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY, {
      ...first,
      selectedChatId: 10,
      updatedAt: 2,
    });

    configureChatTabWindowSession(secondWindow, {
      mayMigrateLegacySession: false,
    });
    const second: ChatTabSession = {
      openChatIds: [99],
      selectedChatId: 99,
      closedChatIds: [],
      updatedAt: 3,
    };
    storage.setItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY, second);

    configureChatTabWindowSession(firstWindow, {
      mayMigrateLegacySession: true,
    });
    expect(
      storage.getItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY, second),
    ).toMatchObject({ ...first, selectedChatId: 10, updatedAt: 2 });
    const finalEnvelope = JSON.parse(
      localStorage.getItem(chatTabSessionStorageKey(firstWindow))!,
    ) as StoredWindowChatTabSession;
    expect(finalEnvelope.tabs[0].tabInstanceId).toBe(firstTabId);
    const secondEnvelope = JSON.parse(
      localStorage.getItem(chatTabSessionStorageKey(secondWindow))!,
    ) as StoredWindowChatTabSession;
    expect(secondEnvelope.tabs).toHaveLength(1);
  });

  it("rejects adoption when the destination already has that chat", () => {
    const storage = createChatTabSessionStorage(localStorage);
    storage.setItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY, {
      openChatIds: [10, 20],
      selectedChatId: 20,
      closedChatIds: [30],
      updatedAt: 1,
    });
    const transferredTabInstanceId =
      "60000000-0000-4000-8000-000000000006" as TabInstanceId;

    expect(() =>
      adoptStoredChatTab({
        chatId: 20,
        tabInstanceId: transferredTabInstanceId,
      }),
    ).toThrow("already has a tab");

    const adopted = JSON.parse(
      localStorage.getItem(chatTabSessionStorageKey(firstWindow))!,
    ) as StoredWindowChatTabSession;
    expect(adopted.tabs.map((tab) => tab.chatId)).toEqual([10, 20]);
    expect(adopted.tabs[0].tabInstanceId).not.toBe(transferredTabInstanceId);
    expect(adopted.closedChatIds).toEqual([30]);
  });

  it("adopts a transferred identity when the chat is not open", () => {
    const storage = createChatTabSessionStorage(localStorage);
    storage.setItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY, {
      openChatIds: [10],
      selectedChatId: 10,
      closedChatIds: [20],
      updatedAt: 1,
    });
    const transferredTabInstanceId =
      "60000000-0000-4000-8000-000000000006" as TabInstanceId;

    adoptStoredChatTab({
      chatId: 20,
      tabInstanceId: transferredTabInstanceId,
    });

    const adopted = JSON.parse(
      localStorage.getItem(chatTabSessionStorageKey(firstWindow))!,
    ) as StoredWindowChatTabSession;
    expect(adopted.tabs.map((tab) => tab.chatId)).toEqual([20, 10]);
    expect(adopted.tabs[0].tabInstanceId).toBe(transferredTabInstanceId);
    expect(adopted.selectedTabInstanceId).toBe(transferredTabInstanceId);
    expect(adopted.closedChatIds).toEqual([]);
    expect(activeStoredChatTabInstanceState(transferredTabInstanceId)).toBe(
      "present",
    );
  });

  it("rejects adoption instead of overwriting an unreadable session", () => {
    const key = chatTabSessionStorageKey(firstWindow);
    localStorage.setItem(key, "{bad json");

    expect(() =>
      adoptStoredChatTab({
        chatId: 20,
        tabInstanceId: "60000000-0000-4000-8000-000000000006" as TabInstanceId,
      }),
    ).toThrow("could not be read");
    expect(localStorage.getItem(key)).toBe("{bad json");
  });

  it("removes only the adopted tab from the current stored session", () => {
    const storage = createChatTabSessionStorage(localStorage);
    storage.setItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY, {
      openChatIds: [10, 20],
      selectedChatId: 20,
      closedChatIds: [30],
      updatedAt: 1,
    });
    const session = JSON.parse(
      localStorage.getItem(chatTabSessionStorageKey(firstWindow))!,
    ) as StoredWindowChatTabSession;
    const removed = session.tabs.find((tab) => tab.chatId === 20)!;

    removeActiveStoredChatTab(removed.tabInstanceId);

    const current = JSON.parse(
      localStorage.getItem(chatTabSessionStorageKey(firstWindow))!,
    ) as StoredWindowChatTabSession;
    expect(current.tabs.map((tab) => tab.chatId)).toEqual([10]);
    expect(current.selectedTabInstanceId).toBeNull();
    expect(current.closedChatIds).toEqual([30]);
  });

  it("distinguishes an absent instance from unavailable session storage", () => {
    const missing = "60000000-0000-4000-8000-000000000006" as TabInstanceId;
    expect(activeStoredChatTabInstanceState(missing)).toBe("absent");

    localStorage.setItem(chatTabSessionStorageKey(firstWindow), "{bad json");
    expect(() => activeStoredChatTabInstanceState(missing)).toThrow(
      "could not be read",
    );
  });

  it("persists a correlated durable source-removal receipt", () => {
    const transferredTabInstanceId =
      "60000000-0000-4000-8000-000000000006" as TabInstanceId;

    markSourceChatTabRemoval("transfer-1", transferredTabInstanceId);

    expect(
      hasSourceChatTabRemoval("transfer-1", transferredTabInstanceId),
    ).toBe(true);
    expect(
      hasSourceChatTabRemoval(
        "transfer-1",
        "70000000-0000-4000-8000-000000000007" as TabInstanceId,
      ),
    ).toBe(false);
    clearSourceChatTabRemoval("transfer-1");
    expect(
      hasSourceChatTabRemoval("transfer-1", transferredTabInstanceId),
    ).toBe(false);
  });

  it("preserves active source-removal receipts during session pruning", () => {
    const transferredTabInstanceId =
      "60000000-0000-4000-8000-000000000006" as TabInstanceId;
    markSourceChatTabRemoval("transfer-1", transferredTabInstanceId);

    pruneChatTabWindowSessions(localStorage, []);

    expect(
      hasSourceChatTabRemoval("transfer-1", transferredTabInstanceId),
    ).toBe(true);
  });

  it("does not replay the retained legacy blob into a second window", () => {
    localStorage.setItem(
      LEGACY_CHAT_TAB_SESSION_STORAGE_KEY,
      JSON.stringify(capturedSessionFixture),
    );
    const storage = createChatTabSessionStorage(localStorage);
    storage.getItem(
      LEGACY_CHAT_TAB_SESSION_STORAGE_KEY,
      capturedSessionFixture as ChatTabSession,
    );

    configureChatTabWindowSession(secondWindow, {
      mayMigrateLegacySession: false,
    });
    const empty: ChatTabSession = {
      openChatIds: [],
      selectedChatId: null,
      closedChatIds: [],
      updatedAt: 0,
    };
    expect(storage.getItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY, empty)).toEqual(
      empty,
    );
    expect(
      localStorage.getItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY),
    ).toBeTruthy();
  });

  it("does not replay legacy tabs after the original migration owner closes", () => {
    localStorage.setItem(
      LEGACY_CHAT_TAB_SESSION_STORAGE_KEY,
      JSON.stringify(capturedSessionFixture),
    );
    const storage = createChatTabSessionStorage(localStorage);
    storage.getItem(
      LEGACY_CHAT_TAB_SESSION_STORAGE_KEY,
      capturedSessionFixture as ChatTabSession,
    );

    pruneChatTabWindowSessions(localStorage, [secondWindow]);
    configureChatTabWindowSession(secondWindow, {
      mayMigrateLegacySession: true,
    });
    const empty: ChatTabSession = {
      openChatIds: [],
      selectedChatId: null,
      closedChatIds: [],
      updatedAt: 0,
    };

    expect(storage.getItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY, empty)).toEqual(
      empty,
    );
    expect(
      localStorage.getItem(chatTabSessionStorageKey(firstWindow)),
    ).toBeNull();
    expect(localStorage.getItem(LEGACY_CHAT_TAB_SESSION_MIGRATION_KEY)).toBe(
      firstWindow,
    );
  });

  it("refreshes the storage atom after bootstrap configures the session", () => {
    const stored: ChatTabSession = {
      openChatIds: [42],
      selectedChatId: 42,
      closedChatIds: [11],
      updatedAt: 9,
    };
    const storage = createChatTabSessionStorage(localStorage);
    storage.setItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY, stored);

    // The atom module was evaluated before this test configured the real
    // window ID, matching production renderer startup order.
    const store = createStore();
    store.set(initializeChatTabSessionStorageAtom);

    expect(store.get(chatTabSessionStorageAtom)).toEqual(stored);
  });

  it("prunes closed sessions without touching restorable or legacy data", () => {
    const storage = createChatTabSessionStorage(localStorage);
    storage.setItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY, {
      openChatIds: [10],
      selectedChatId: 10,
      closedChatIds: [],
      updatedAt: 1,
    });
    configureChatTabWindowSession(secondWindow, {
      mayMigrateLegacySession: false,
    });
    storage.setItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY, {
      openChatIds: [20],
      selectedChatId: 20,
      closedChatIds: [],
      updatedAt: 2,
    });
    localStorage.setItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY, "{}");

    pruneChatTabWindowSessions(localStorage, [firstWindow]);

    expect(
      localStorage.getItem(chatTabSessionStorageKey(firstWindow)),
    ).toBeTruthy();
    expect(
      localStorage.getItem(chatTabSessionStorageKey(secondWindow)),
    ).toBeNull();
    expect(localStorage.getItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY)).toBe(
      "{}",
    );
  });

  it("reconciles a crash-window duplicate identity into the newest session", () => {
    const duplicate = "60000000-0000-4000-8000-000000000006" as TabInstanceId;
    const first: StoredWindowChatTabSession = {
      version: 2,
      windowSessionId: firstWindow,
      tabs: [{ chatId: 10, tabInstanceId: duplicate }],
      selectedTabInstanceId: duplicate,
      closedChatIds: [],
      updatedAt: 1,
    };
    const second: StoredWindowChatTabSession = {
      version: 2,
      windowSessionId: secondWindow,
      tabs: [
        { chatId: 10, tabInstanceId: duplicate },
        {
          chatId: 20,
          tabInstanceId:
            "70000000-0000-4000-8000-000000000007" as TabInstanceId,
        },
      ],
      selectedTabInstanceId: duplicate,
      closedChatIds: [],
      updatedAt: 2,
    };
    localStorage.setItem(
      chatTabSessionStorageKey(firstWindow),
      JSON.stringify(first),
    );
    localStorage.setItem(
      chatTabSessionStorageKey(secondWindow),
      JSON.stringify(second),
    );

    pruneChatTabWindowSessions(localStorage, [firstWindow, secondWindow]);

    const reconciledFirst = JSON.parse(
      localStorage.getItem(chatTabSessionStorageKey(firstWindow))!,
    ) as StoredWindowChatTabSession;
    const reconciledSecond = JSON.parse(
      localStorage.getItem(chatTabSessionStorageKey(secondWindow))!,
    ) as StoredWindowChatTabSession;
    expect(reconciledFirst.tabs).toEqual([]);
    expect(reconciledFirst.selectedTabInstanceId).toBeNull();
    expect(reconciledSecond).toEqual(second);
  });

  it("falls back without blocking startup when browser storage is unavailable", () => {
    const storageError = new DOMException("Storage denied", "SecurityError");
    const unavailableStorage = {
      get length(): number {
        throw storageError;
      },
      clear: vi.fn(() => {
        throw storageError;
      }),
      getItem: vi.fn(() => {
        throw storageError;
      }),
      key: vi.fn(() => {
        throw storageError;
      }),
      removeItem: vi.fn(() => {
        throw storageError;
      }),
      setItem: vi.fn(() => {
        throw storageError;
      }),
    } satisfies Storage;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const storage = createChatTabSessionStorage(unavailableStorage);
    const fallback: ChatTabSession = {
      openChatIds: [],
      selectedChatId: null,
      closedChatIds: [],
      updatedAt: 0,
    };

    expect(
      storage.getItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY, fallback),
    ).toEqual(fallback);
    expect(() =>
      storage.setItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY, fallback),
    ).not.toThrow();
    expect(() => storage.removeItem()).not.toThrow();
    expect(() =>
      pruneChatTabWindowSessions(unavailableStorage, [firstWindow]),
    ).not.toThrow();
    expect(consoleError).toHaveBeenCalledTimes(4);
  });
});
