import { beforeEach, describe, expect, it, vi } from "vitest";
import capturedSessionFixture from "@/__tests__/golden_single_window/fixtures/chat-tab-session.real.json";
import type { ChatTabSession } from "@/atoms/chatAtoms";
import {
  CHAT_TAB_SESSIONS_STORAGE_KEY,
  LEGACY_CHAT_TAB_SESSION_STORAGE_KEY,
  configureChatTabWindowSession,
  createChatTabSessionStorage,
  type StoredChatTabSessions,
} from "./chat_tab_session_storage";
import type { WindowSessionId } from "./types";

const firstWindow = "10000000-0000-4000-8000-000000000001" as WindowSessionId;
const secondWindow = "20000000-0000-4000-8000-000000000002" as WindowSessionId;

describe("per-window chat tab session storage", () => {
  beforeEach(() => {
    localStorage.clear();
    configureChatTabWindowSession(firstWindow);
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

    storage.setItem(
      LEGACY_CHAT_TAB_SESSION_STORAGE_KEY,
      capturedSessionFixture as ChatTabSession,
    );

    expect(
      localStorage.getItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY),
    ).toBeTruthy();
    const migrated = JSON.parse(
      localStorage.getItem(CHAT_TAB_SESSIONS_STORAGE_KEY)!,
    ) as StoredChatTabSessions;
    expect(migrated.version).toBe(2);
    expect(migrated.windows[firstWindow].tabs.map((tab) => tab.chatId)).toEqual(
      capturedSessionFixture.openChatIds,
    );
    expect(
      migrated.windows[firstWindow].tabs.every((tab) => tab.tabInstanceId),
    ).toBe(true);
  });

  it("keeps independent sessions and stable tab instance identities", () => {
    const storage = createChatTabSessionStorage(localStorage);
    const first: ChatTabSession = {
      openChatIds: [10, 20],
      selectedChatId: 20,
      closedChatIds: [30],
      updatedAt: 1,
    };
    storage.setItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY, first);
    const firstEnvelope = JSON.parse(
      localStorage.getItem(CHAT_TAB_SESSIONS_STORAGE_KEY)!,
    ) as StoredChatTabSessions;
    const firstTabId = firstEnvelope.windows[firstWindow].tabs[0].tabInstanceId;

    storage.setItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY, {
      ...first,
      selectedChatId: 10,
      updatedAt: 2,
    });

    configureChatTabWindowSession(secondWindow);
    const second: ChatTabSession = {
      openChatIds: [99],
      selectedChatId: 99,
      closedChatIds: [],
      updatedAt: 3,
    };
    storage.setItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY, second);

    configureChatTabWindowSession(firstWindow);
    expect(
      storage.getItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY, second),
    ).toMatchObject({ ...first, selectedChatId: 10, updatedAt: 2 });
    const finalEnvelope = JSON.parse(
      localStorage.getItem(CHAT_TAB_SESSIONS_STORAGE_KEY)!,
    ) as StoredChatTabSessions;
    expect(finalEnvelope.windows[firstWindow].tabs[0].tabInstanceId).toBe(
      firstTabId,
    );
    expect(finalEnvelope.windows[secondWindow].tabs).toHaveLength(1);
  });
});
