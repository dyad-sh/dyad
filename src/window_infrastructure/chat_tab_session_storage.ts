import type { ChatTabSession } from "@/atoms/chatAtoms";
import type {
  TabInstanceId,
  WindowSessionId,
} from "@/window_infrastructure/types";

export const CHAT_TAB_SESSION_STORAGE_PREFIX = "chat-tab-session-v2:";
export const LEGACY_CHAT_TAB_SESSION_STORAGE_KEY = "chat-tab-session";
export const LEGACY_CHAT_TAB_SESSION_MIGRATION_KEY =
  "chat-tab-session-legacy-migrated-v2";

export interface StoredChatTab {
  tabInstanceId: TabInstanceId;
  chatId: number;
}

export interface StoredWindowChatTabSession {
  version: 2;
  windowSessionId: WindowSessionId;
  tabs: StoredChatTab[];
  selectedTabInstanceId: TabInstanceId | null;
  closedChatIds: number[];
  updatedAt: number;
}

const LEGACY_SINGLE_WINDOW_SESSION_ID =
  "00000000-0000-4000-8000-000000000001" as WindowSessionId;

let activeWindowSessionId: WindowSessionId = LEGACY_SINGLE_WINDOW_SESSION_ID;
let mayMigrateLegacySession = false;

export function configureChatTabWindowSession(
  windowSessionId: WindowSessionId,
  options: { mayMigrateLegacySession: boolean },
): void {
  activeWindowSessionId = windowSessionId;
  mayMigrateLegacySession = options.mayMigrateLegacySession;
}

export function chatTabSessionStorageKey(
  windowSessionId: WindowSessionId,
): string {
  return `${CHAT_TAB_SESSION_STORAGE_PREFIX}${windowSessionId}`;
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
  expectedWindowSessionId: WindowSessionId,
): value is StoredWindowChatTabSession {
  if (value === null || typeof value !== "object") return false;
  const session = value as Partial<StoredWindowChatTabSession>;
  return (
    session.version === 2 &&
    session.windowSessionId === expectedWindowSessionId &&
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

function parseStoredSession(
  raw: string | null,
  windowSessionId: WindowSessionId,
): StoredWindowChatTabSession | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredWindowSession(parsed, windowSessionId) ? parsed : null;
  } catch {
    return null;
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
  windowSessionId: WindowSessionId,
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
    version: 2,
    windowSessionId,
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

export function pruneChatTabWindowSessions(
  storage: Storage,
  restorableWindowSessionIds: readonly WindowSessionId[],
): void {
  try {
    const restorable = new Set(
      restorableWindowSessionIds.map(chatTabSessionStorageKey),
    );
    const staleKeys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (
        key?.startsWith(CHAT_TAB_SESSION_STORAGE_PREFIX) &&
        !restorable.has(key)
      ) {
        staleKeys.push(key);
      }
    }
    for (const key of staleKeys) storage.removeItem(key);
  } catch (error) {
    console.error("Failed to prune chat tab window sessions", error);
  }
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
      try {
        const storage = getStorage();
        if (!storage) return initialValue;
        const sessionKey = chatTabSessionStorageKey(activeWindowSessionId);
        const current = parseStoredSession(
          storage.getItem(sessionKey),
          activeWindowSessionId,
        );
        if (current) return fromStoredSession(current);

        if (!mayMigrateLegacySession) return initialValue;
        if (storage.getItem(LEGACY_CHAT_TAB_SESSION_MIGRATION_KEY) !== null) {
          return initialValue;
        }
        const legacy = parseLegacySession(
          storage.getItem(LEGACY_CHAT_TAB_SESSION_STORAGE_KEY),
        );
        if (!legacy) return initialValue;

        // The main process designates exactly one stable session as the legacy
        // migration owner. Persist immediately so later reads never replay the
        // retained compatibility blob into another product window.
        storage.setItem(
          sessionKey,
          JSON.stringify(toStoredSession(legacy, activeWindowSessionId)),
        );
        storage.setItem(
          LEGACY_CHAT_TAB_SESSION_MIGRATION_KEY,
          activeWindowSessionId,
        );
        return legacy;
      } catch (error) {
        console.error("Failed to read chat tab window session", error);
        return initialValue;
      }
    },
    setItem(_key: string, value: ChatTabSession): void {
      try {
        const storage = getStorage();
        if (!storage || !isLegacySession(value)) return;
        const sessionKey = chatTabSessionStorageKey(activeWindowSessionId);
        const previous =
          parseStoredSession(
            storage.getItem(sessionKey),
            activeWindowSessionId,
          ) ?? undefined;
        storage.setItem(
          sessionKey,
          JSON.stringify(
            toStoredSession(value, activeWindowSessionId, previous),
          ),
        );
      } catch (error) {
        console.error("Failed to persist chat tab window session", error);
      }
    },
    removeItem(): void {
      try {
        getStorage()?.removeItem(
          chatTabSessionStorageKey(activeWindowSessionId),
        );
      } catch (error) {
        console.error("Failed to remove chat tab window session", error);
      }
    },
  };
}
