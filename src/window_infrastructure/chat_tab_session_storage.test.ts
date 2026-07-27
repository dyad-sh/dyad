import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "jotai";
import capturedSessionFixture from "@/__tests__/golden_single_window/fixtures/chat-tab-session.real.json";
import {
  chatTabSessionStorageAtom,
  initializeChatTabSessionStorageAtom,
  type ChatTabSession,
} from "@/atoms/chatAtoms";
import {
  LEGACY_CHAT_TAB_SESSION_STORAGE_KEY,
  chatTabSessionStorageKey,
  configureChatTabWindowSession,
  createChatTabSessionStorage,
  pruneChatTabWindowSessions,
  type StoredWindowChatTabSession,
} from "./chat_tab_session_storage";
import type { WindowSessionId } from "./types";

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
});
