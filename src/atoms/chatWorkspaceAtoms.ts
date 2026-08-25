import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { getActiveWindowSessionId } from "@/window_infrastructure/chat_tab_session_storage";
import type { WindowSessionId } from "@/window_infrastructure/types";

export interface ChatWorkspaceState {
  visibleChatIds: number[];
}

export type ChatWorkspaceByAppId = Record<number, ChatWorkspaceState>;

const CHAT_WORKSPACE_STORAGE_VERSION = 1;
export const CHAT_WORKSPACE_STORAGE_PREFIX = "chat-workspace-v1:";

export function chatWorkspaceStorageKey(
  windowSessionId: WindowSessionId,
): string {
  return `${CHAT_WORKSPACE_STORAGE_PREFIX}${windowSessionId}`;
}

interface PersistedChatWorkspaceState {
  version: typeof CHAT_WORKSPACE_STORAGE_VERSION;
  workspaces: ChatWorkspaceByAppId;
}

interface ChatWorkspaceSyncStorage {
  getItem: (
    key: string,
    initialValue: ChatWorkspaceByAppId,
  ) => ChatWorkspaceByAppId;
  setItem: (key: string, newValue: ChatWorkspaceByAppId) => void;
  removeItem: (key: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeChatWorkspaceByAppId(
  value: unknown,
): ChatWorkspaceByAppId {
  if (!isRecord(value)) return {};

  const normalized: ChatWorkspaceByAppId = {};
  for (const [rawAppId, rawWorkspace] of Object.entries(value)) {
    const appId = Number(rawAppId);
    if (
      !Number.isSafeInteger(appId) ||
      appId <= 0 ||
      !isRecord(rawWorkspace) ||
      !Array.isArray(rawWorkspace.visibleChatIds)
    ) {
      continue;
    }

    const visibleChatIds = Array.from(
      new Set(
        rawWorkspace.visibleChatIds.filter(
          (chatId): chatId is number =>
            typeof chatId === "number" &&
            Number.isSafeInteger(chatId) &&
            chatId > 0,
        ),
      ),
    );
    normalized[appId] = { visibleChatIds };
  }

  return normalized;
}

function deserializeChatWorkspaceState(
  rawValue: string | null,
  initialValue: ChatWorkspaceByAppId,
): ChatWorkspaceByAppId {
  if (rawValue === null) return initialValue;

  try {
    const persisted: unknown = JSON.parse(rawValue);
    if (
      !isRecord(persisted) ||
      persisted.version !== CHAT_WORKSPACE_STORAGE_VERSION
    ) {
      return initialValue;
    }
    return normalizeChatWorkspaceByAppId(persisted.workspaces);
  } catch {
    return initialValue;
  }
}

export function createChatWorkspaceStorage(
  getStorage: () => Storage | undefined = () =>
    typeof window === "undefined" ? undefined : window.localStorage,
): ChatWorkspaceSyncStorage {
  return {
    getItem(_key, initialValue) {
      return deserializeChatWorkspaceState(
        getStorage()?.getItem(
          chatWorkspaceStorageKey(getActiveWindowSessionId()),
        ) ?? null,
        initialValue,
      );
    },
    setItem(_key, newValue) {
      const persisted: PersistedChatWorkspaceState = {
        version: CHAT_WORKSPACE_STORAGE_VERSION,
        workspaces: normalizeChatWorkspaceByAppId(newValue),
      };
      getStorage()?.setItem(
        chatWorkspaceStorageKey(getActiveWindowSessionId()),
        JSON.stringify(persisted),
      );
    },
    removeItem(_key) {
      getStorage()?.removeItem(
        chatWorkspaceStorageKey(getActiveWindowSessionId()),
      );
    },
  };
}

export function pruneChatWorkspaceWindowSessions(
  storage: Storage,
  restorableWindowSessionIds: readonly WindowSessionId[],
): void {
  try {
    const restorableKeys = new Set(
      restorableWindowSessionIds.map(chatWorkspaceStorageKey),
    );
    const staleKeys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (
        key?.startsWith(CHAT_WORKSPACE_STORAGE_PREFIX) &&
        !restorableKeys.has(key)
      ) {
        staleKeys.push(key);
      }
    }
    for (const key of staleKeys) storage.removeItem(key);
  } catch (error) {
    console.error("Failed to prune chat workspace window sessions", error);
  }
}

export function getVisibleWorkspaceChatIds(
  workspaceChatIds: number[],
  validChatIds: Set<number>,
): number[] {
  return Array.from(new Set(workspaceChatIds)).filter((chatId) =>
    validChatIds.has(chatId),
  );
}

export function getVisibleChatViewIds({
  workspaceChatIds,
  focusedChatId,
  validChatIds,
  isWorkspaceView,
}: {
  workspaceChatIds: number[];
  focusedChatId: number | undefined;
  validChatIds: Set<number>;
  isWorkspaceView: boolean;
}): number[] {
  if (isWorkspaceView) {
    return getVisibleWorkspaceChatIds(workspaceChatIds, validChatIds);
  }
  return focusedChatId === undefined ? [] : [focusedChatId];
}

const chatWorkspaceStorage = createChatWorkspaceStorage();

export const chatWorkspaceByAppIdAtom = atomWithStorage<ChatWorkspaceByAppId>(
  "chat-workspace-by-window",
  {},
  chatWorkspaceStorage,
);

export const initializeChatWorkspaceStorageAtom = atom(null, (_get, set) => {
  set(
    chatWorkspaceByAppIdAtom,
    chatWorkspaceStorage.getItem("chat-workspace-by-window", {}),
  );
});

function updateWorkspace(
  workspaces: ChatWorkspaceByAppId,
  appId: number,
  update: (chatIds: number[]) => number[],
): ChatWorkspaceByAppId {
  const visibleChatIds = update(workspaces[appId]?.visibleChatIds ?? []);
  return {
    ...workspaces,
    [appId]: { visibleChatIds },
  };
}

export const showChatInWorkspaceAtom = atom(
  null,
  (get, set, { appId, chatId }: { appId: number; chatId: number }) => {
    set(
      chatWorkspaceByAppIdAtom,
      updateWorkspace(get(chatWorkspaceByAppIdAtom), appId, (chatIds) =>
        chatIds.includes(chatId) ? chatIds : [...chatIds, chatId],
      ),
    );
  },
);

export const hideChatFromWorkspaceAtom = atom(
  null,
  (get, set, { appId, chatId }: { appId: number; chatId: number }) => {
    set(
      chatWorkspaceByAppIdAtom,
      updateWorkspace(get(chatWorkspaceByAppIdAtom), appId, (chatIds) =>
        chatIds.filter((id) => id !== chatId),
      ),
    );
  },
);

export const pruneChatWorkspaceAtom = atom(
  null,
  (
    get,
    set,
    { appId, validChatIds }: { appId: number; validChatIds: Set<number> },
  ) => {
    const workspaces = get(chatWorkspaceByAppIdAtom);
    const current = workspaces[appId]?.visibleChatIds ?? [];
    const visibleChatIds = current.filter((id) => validChatIds.has(id));
    if (
      visibleChatIds.length === current.length &&
      visibleChatIds.every((id, index) => current[index] === id)
    ) {
      return;
    }
    set(chatWorkspaceByAppIdAtom, {
      ...workspaces,
      [appId]: { visibleChatIds },
    });
  },
);
