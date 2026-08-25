import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export interface ChatWorkspaceState {
  visibleChatIds: number[];
}

export type ChatWorkspaceByAppId = Record<number, ChatWorkspaceState>;

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
  return focusedChatId !== undefined && validChatIds.has(focusedChatId)
    ? [focusedChatId]
    : [];
}

export const chatWorkspaceByAppIdAtom = atomWithStorage<ChatWorkspaceByAppId>(
  "chat-workspace-by-app-id",
  {},
  undefined,
  { getOnInit: true },
);

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
