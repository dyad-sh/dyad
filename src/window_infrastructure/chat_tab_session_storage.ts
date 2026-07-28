import type { ChatTabSession } from "@/atoms/chatAtoms";
import type {
  TabInstanceId,
  WindowSessionId,
} from "@/window_infrastructure/types";

export const CHAT_TAB_SESSION_STORAGE_PREFIX = "chat-tab-session-v2:";
export const LEGACY_CHAT_TAB_SESSION_STORAGE_KEY = "chat-tab-session";
export const LEGACY_CHAT_TAB_SESSION_MIGRATION_KEY =
  "chat-tab-session-legacy-migrated-v2";
const CHAT_TAB_TRANSFER_REMOVAL_PREFIX = "chat-tab-transfer-removal-v1:";
const CHAT_TAB_TRANSFER_REMOVAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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

export function getActiveWindowSessionId(): WindowSessionId {
  return activeWindowSessionId;
}

export function getActiveStoredChatTab(
  chatId: number,
): StoredChatTab | undefined {
  try {
    const raw = window.localStorage.getItem(
      chatTabSessionStorageKey(activeWindowSessionId),
    );
    return parseStoredSession(raw, activeWindowSessionId)?.tabs.find(
      (tab) => tab.chatId === chatId,
    );
  } catch {
    return undefined;
  }
}

export function activeStoredChatTabInstanceState(
  tabInstanceId: TabInstanceId,
): "present" | "absent" {
  const raw = window.localStorage.getItem(
    chatTabSessionStorageKey(activeWindowSessionId),
  );
  if (raw === null) return "absent";
  const session = parseStoredSession(raw, activeWindowSessionId);
  if (!session) {
    throw new Error("The chat tab session could not be read");
  }
  return session.tabs.some((tab) => tab.tabInstanceId === tabInstanceId)
    ? "present"
    : "absent";
}

export function assertActiveStoredChatTabInstance(
  tabInstanceId: TabInstanceId,
  expected: "present" | "absent",
): void {
  if (activeStoredChatTabInstanceState(tabInstanceId) !== expected) {
    throw new Error(
      expected === "present"
        ? "The adopted chat tab was not persisted"
        : "The transferred chat tab was not removed from storage",
    );
  }
}

export function markSourceChatTabRemoval(
  transferId: string,
  tabInstanceId: TabInstanceId,
): void {
  window.localStorage.setItem(
    `${CHAT_TAB_TRANSFER_REMOVAL_PREFIX}${transferId}`,
    JSON.stringify({ tabInstanceId, removedAt: Date.now() }),
  );
}

export function hasSourceChatTabRemoval(
  transferId: string,
  tabInstanceId: TabInstanceId,
): boolean {
  const raw = window.localStorage.getItem(
    `${CHAT_TAB_TRANSFER_REMOVAL_PREFIX}${transferId}`,
  );
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as {
      tabInstanceId?: unknown;
      removedAt?: unknown;
    };
    return (
      parsed.tabInstanceId === tabInstanceId &&
      typeof parsed.removedAt === "number"
    );
  } catch {
    return false;
  }
}

export function clearSourceChatTabRemoval(transferId: string): void {
  try {
    window.localStorage.removeItem(
      `${CHAT_TAB_TRANSFER_REMOVAL_PREFIX}${transferId}`,
    );
  } catch (error) {
    console.error("Failed to clear chat tab transfer receipt", error);
  }
}

export function adoptStoredChatTab(tab: StoredChatTab): void {
  const storage = window.localStorage;
  const key = chatTabSessionStorageKey(activeWindowSessionId);
  const current = parseStoredSession(
    storage.getItem(key),
    activeWindowSessionId,
  );
  if (
    current?.tabs.some(
      (candidate) =>
        candidate.chatId === tab.chatId &&
        candidate.tabInstanceId !== tab.tabInstanceId,
    )
  ) {
    throw new Error("The destination already has a tab for this chat");
  }
  const tabs = [
    tab,
    ...(current?.tabs ?? []).filter(
      (candidate) => candidate.tabInstanceId !== tab.tabInstanceId,
    ),
  ];
  storage.setItem(
    key,
    JSON.stringify({
      version: 2,
      windowSessionId: activeWindowSessionId,
      tabs,
      selectedTabInstanceId: tab.tabInstanceId,
      closedChatIds: (current?.closedChatIds ?? []).filter(
        (chatId) => chatId !== tab.chatId,
      ),
      updatedAt: Date.now(),
    } satisfies StoredWindowChatTabSession),
  );
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

    const sessions = restorableWindowSessionIds.flatMap((windowSessionId) => {
      const key = chatTabSessionStorageKey(windowSessionId);
      const session = parseStoredSession(storage.getItem(key), windowSessionId);
      return session ? [{ key, session }] : [];
    });
    const ownerByTabInstanceId = new Map<
      TabInstanceId,
      { key: string; updatedAt: number }
    >();
    for (const { key, session } of sessions) {
      for (const tab of session.tabs) {
        const owner = ownerByTabInstanceId.get(tab.tabInstanceId);
        if (
          !owner ||
          session.updatedAt > owner.updatedAt ||
          (session.updatedAt === owner.updatedAt && key > owner.key)
        ) {
          ownerByTabInstanceId.set(tab.tabInstanceId, {
            key,
            updatedAt: session.updatedAt,
          });
        }
      }
    }
    for (const { key, session } of sessions) {
      const tabs = session.tabs.filter(
        (tab) => ownerByTabInstanceId.get(tab.tabInstanceId)?.key === key,
      );
      if (tabs.length === session.tabs.length) continue;
      storage.setItem(
        key,
        JSON.stringify({
          ...session,
          tabs,
          selectedTabInstanceId: tabs.some(
            (tab) => tab.tabInstanceId === session.selectedTabInstanceId,
          )
            ? session.selectedTabInstanceId
            : null,
        } satisfies StoredWindowChatTabSession),
      );
    }
    const staleTransferKeys: string[] = [];
    const staleBefore = Date.now() - CHAT_TAB_TRANSFER_REMOVAL_MAX_AGE_MS;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(CHAT_TAB_TRANSFER_REMOVAL_PREFIX)) continue;
      try {
        const parsed = JSON.parse(storage.getItem(key) ?? "") as {
          removedAt?: unknown;
        };
        if (
          typeof parsed.removedAt !== "number" ||
          parsed.removedAt < staleBefore
        ) {
          staleTransferKeys.push(key);
        }
      } catch {
        staleTransferKeys.push(key);
      }
    }
    for (const key of staleTransferKeys) storage.removeItem(key);
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
