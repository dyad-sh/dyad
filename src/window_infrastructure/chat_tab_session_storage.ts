import type { ChatTabSession } from "@/atoms/chatAtoms";
import type {
  TabInstanceId,
  WindowSessionId,
} from "@/window_infrastructure/types";

export const CHAT_TAB_SESSIONS_STORAGE_KEY = "chat-tab-sessions-v2";
export const LEGACY_CHAT_TAB_SESSION_STORAGE_KEY = "chat-tab-session";

export interface StoredChatTab {
  tabInstanceId: TabInstanceId;
  chatId: number;
}

export interface StoredWindowChatTabSession {
  tabs: StoredChatTab[];
  selectedTabInstanceId: TabInstanceId | null;
  closedChatIds: number[];
  updatedAt: number;
}

export interface StoredChatTabSessions {
  version: 2;
  windows: Record<WindowSessionId, StoredWindowChatTabSession>;
}

const LEGACY_SINGLE_WINDOW_SESSION_ID =
  "00000000-0000-4000-8000-000000000001" as WindowSessionId;

let activeWindowSessionId: WindowSessionId = LEGACY_SINGLE_WINDOW_SESSION_ID;

export function configureChatTabWindowSession(
  windowSessionId: WindowSessionId,
): void {
  activeWindowSessionId = windowSessionId;
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "number")
  );
}

function isLegacySession(value: unknown): value is ChatTabSession {
  if (value === null || typeof value !== "object") return false;
  const session = value as Partial<ChatTabSession>;
  return (
    isNumberArray(session.openChatIds) &&
    (session.selectedChatId === null ||
      typeof session.selectedChatId === "number") &&
    isNumberArray(session.closedChatIds) &&
    typeof session.updatedAt === "number"
  );
}

function isStoredWindowSession(
  value: unknown,
): value is StoredWindowChatTabSession {
  if (value === null || typeof value !== "object") return false;
  const session = value as Partial<StoredWindowChatTabSession>;
  return (
    Array.isArray(session.tabs) &&
    session.tabs.every(
      (tab) =>
        tab !== null &&
        typeof tab === "object" &&
        typeof (tab as Partial<StoredChatTab>).tabInstanceId === "string" &&
        typeof (tab as Partial<StoredChatTab>).chatId === "number",
    ) &&
    (session.selectedTabInstanceId === null ||
      typeof session.selectedTabInstanceId === "string") &&
    isNumberArray(session.closedChatIds) &&
    typeof session.updatedAt === "number"
  );
}

function parseSessions(raw: string | null): StoredChatTabSessions {
  if (raw === null) return { version: 2, windows: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<StoredChatTabSessions>;
    if (
      parsed.version !== 2 ||
      parsed.windows === null ||
      typeof parsed.windows !== "object"
    ) {
      return { version: 2, windows: {} };
    }
    const windows = Object.fromEntries(
      Object.entries(parsed.windows).filter(([, session]) =>
        isStoredWindowSession(session),
      ),
    ) as Record<WindowSessionId, StoredWindowChatTabSession>;
    return { version: 2, windows };
  } catch {
    return { version: 2, windows: {} };
  }
}

function parseLegacySession(raw: string | null): ChatTabSession | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isLegacySession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function createTabInstanceId(): TabInstanceId {
  return crypto.randomUUID() as TabInstanceId;
}

function toStoredSession(
  session: ChatTabSession,
  previous?: StoredWindowChatTabSession,
): StoredWindowChatTabSession {
  const previousIds = new Map(
    previous?.tabs.map((tab) => [tab.chatId, tab.tabInstanceId]) ?? [],
  );
  const tabs = session.openChatIds.map((chatId) => ({
    chatId,
    tabInstanceId: previousIds.get(chatId) ?? createTabInstanceId(),
  }));
  return {
    tabs,
    selectedTabInstanceId:
      tabs.find((tab) => tab.chatId === session.selectedChatId)
        ?.tabInstanceId ?? null,
    closedChatIds: session.closedChatIds,
    updatedAt: session.updatedAt,
  };
}

function fromStoredSession(
  session: StoredWindowChatTabSession,
): ChatTabSession {
  return {
    openChatIds: session.tabs.map((tab) => tab.chatId),
    selectedChatId:
      session.tabs.find(
        (tab) => tab.tabInstanceId === session.selectedTabInstanceId,
      )?.chatId ?? null,
    closedChatIds: session.closedChatIds,
    updatedAt: session.updatedAt,
  };
}

export function createChatTabSessionStorage(
  storageOrFactory: Storage | (() => Storage | undefined),
) {
  const getStorage = () =>
    typeof storageOrFactory === "function"
      ? storageOrFactory()
      : storageOrFactory;
  return {
    getItem(_key: string, initialValue: ChatTabSession): ChatTabSession {
      const storage = getStorage();
      if (!storage) return initialValue;
      const sessions = parseSessions(
        storage.getItem(CHAT_TAB_SESSIONS_STORAGE_KEY),
      );
      const current = sessions.windows[activeWindowSessionId];
      if (current) return fromStoredSession(current);

      // Keep the old key readable for one release. The first write below
      // migrates it into the current window without deleting the old blob.
      return (
        parseLegacySession(
          storage.getItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY),
        ) ?? initialValue
      );
    },
    setItem(_key: string, value: ChatTabSession): void {
      const storage = getStorage();
      if (!storage || !isLegacySession(value)) return;
      const sessions = parseSessions(
        storage.getItem(CHAT_TAB_SESSIONS_STORAGE_KEY),
      );
      sessions.windows[activeWindowSessionId] = toStoredSession(
        value,
        sessions.windows[activeWindowSessionId],
      );
      storage.setItem(CHAT_TAB_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
    },
    removeItem(): void {
      const storage = getStorage();
      if (!storage) return;
      const sessions = parseSessions(
        storage.getItem(CHAT_TAB_SESSIONS_STORAGE_KEY),
      );
      delete sessions.windows[activeWindowSessionId];
      storage.setItem(CHAT_TAB_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
    },
  };
}
