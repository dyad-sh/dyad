import type { FileAttachment, Message, AgentTodo } from "@/ipc/types";
import type { Getter, Setter } from "jotai";
import { atom } from "jotai";

// Per-chat atoms implemented with maps keyed by chatId
export const chatMessagesByIdAtom = atom<Map<number, Message[]>>(new Map());
export const chatErrorByIdAtom = atom<Map<number, string | null>>(new Map());

// Atom to hold the currently selected chat ID
export const selectedChatIdAtom = atom<number | null>(null);

export const isStreamingByIdAtom = atom<Map<number, boolean>>(new Map());
export const chatInputValueAtom = atom<string>("");
export const homeChatInputValueAtom = atom<string>("");

// Used for scrolling to the bottom of the chat messages (per chat)
export const chatStreamCountByIdAtom = atom<Map<number, number>>(new Map());
export const recentStreamChatIdsAtom = atom<Set<number>>(new Set<number>());
export const recentViewedChatIdsAtom = atom<number[]>([]);
// Track explicitly closed tabs - these should not reappear in the tab bar
export const closedChatIdsAtom = atom<Set<number>>(new Set<number>());
// Track chats that were opened/created in the current session - only these show as tabs
export const sessionOpenedChatIdsAtom = atom<Set<number>>(new Set<number>());
const MAX_RECENT_VIEWED_CHAT_IDS = 100;

// Helper to remove a chat ID from the closed set (used when a closed tab is re-opened)
function removeFromClosedSet(get: Getter, set: Setter, chatId: number): void {
  const closedIds = get(closedChatIdsAtom);
  if (closedIds.has(chatId)) {
    const newClosedIds = new Set(closedIds);
    newClosedIds.delete(chatId);
    set(closedChatIdsAtom, newClosedIds);
  }
}
export const setRecentViewedChatIdsAtom = atom(
  null,
  (_get, set, chatIds: number[]) => {
    if (chatIds.length > MAX_RECENT_VIEWED_CHAT_IDS) {
      set(
        recentViewedChatIdsAtom,
        chatIds.slice(0, MAX_RECENT_VIEWED_CHAT_IDS),
      );
    } else {
      set(recentViewedChatIdsAtom, chatIds);
    }
  },
);
// Add a chat ID to the recent list only if it's not already present.
// Unlike pushRecentViewedChatIdAtom, this does NOT move existing IDs to the front,
// preserving the current tab order for chats already tracked.
export const ensureRecentViewedChatIdAtom = atom(
  null,
  (get, set, chatId: number) => {
    const currentIds = get(recentViewedChatIdsAtom);
    if (!currentIds.includes(chatId)) {
      const nextIds = [chatId, ...currentIds];
      if (nextIds.length > MAX_RECENT_VIEWED_CHAT_IDS) {
        nextIds.length = MAX_RECENT_VIEWED_CHAT_IDS;
      }
      set(recentViewedChatIdsAtom, nextIds);
    }
    // Remove from closed set when explicitly selected
    removeFromClosedSet(get, set, chatId);
    // Add to session set when chat is selected/opened
    const sessionIds = get(sessionOpenedChatIdsAtom);
    if (!sessionIds.has(chatId)) {
      const newSessionIds = new Set(sessionIds);
      newSessionIds.add(chatId);
      set(sessionOpenedChatIdsAtom, newSessionIds);
    }
  },
);
export const pushRecentViewedChatIdAtom = atom(
  null,
  (get, set, chatId: number) => {
    const nextIds = get(recentViewedChatIdsAtom).filter((id) => id !== chatId);
    nextIds.unshift(chatId);
    if (nextIds.length > MAX_RECENT_VIEWED_CHAT_IDS) {
      nextIds.length = MAX_RECENT_VIEWED_CHAT_IDS;
    }
    set(recentViewedChatIdsAtom, nextIds);
    // Remove from closed set when explicitly selected
    removeFromClosedSet(get, set, chatId);
    // Add to session set when chat is selected/opened
    const sessionIds = get(sessionOpenedChatIdsAtom);
    if (!sessionIds.has(chatId)) {
      const newSessionIds = new Set(sessionIds);
      newSessionIds.add(chatId);
      set(sessionOpenedChatIdsAtom, newSessionIds);
    }
  },
);
export const removeRecentViewedChatIdAtom = atom(
  null,
  (get, set, chatId: number) => {
    set(
      recentViewedChatIdsAtom,
      get(recentViewedChatIdsAtom).filter((id) => id !== chatId),
    );
    // Add to closed set so it doesn't reappear
    const closedIds = get(closedChatIdsAtom);
    const newClosedIds = new Set(closedIds);
    newClosedIds.add(chatId);
    set(closedChatIdsAtom, newClosedIds);
  },
);
// Prune closed chat IDs that no longer exist in the chats list
export const pruneClosedChatIdsAtom = atom(
  null,
  (get, set, validChatIds: Set<number>) => {
    const closedIds = get(closedChatIdsAtom);
    let changed = false;
    const pruned = new Set<number>();
    for (const id of closedIds) {
      if (validChatIds.has(id)) {
        pruned.add(id);
      } else {
        changed = true;
      }
    }
    if (changed) {
      set(closedChatIdsAtom, pruned);
    }
  },
);
// Remove a chat ID from all tracking (used when chat is deleted)
export const removeChatIdFromAllTrackingAtom = atom(
  null,
  (get, set, chatId: number) => {
    set(
      recentViewedChatIdsAtom,
      get(recentViewedChatIdsAtom).filter((id) => id !== chatId),
    );
    removeFromClosedSet(get, set, chatId);
  },
);

export const attachmentsAtom = atom<FileAttachment[]>([]);

// Agent tool consent request queue
export interface PendingAgentConsent {
  requestId: string;
  chatId: number;
  toolName: string;
  toolDescription?: string | null;
  inputPreview?: string | null;
}

export const pendingAgentConsentsAtom = atom<PendingAgentConsent[]>([]);

// Agent todos per chat
export const agentTodosByChatIdAtom = atom<Map<number, AgentTodo[]>>(new Map());

// Flag: set when user switches to plan mode from another mode in a chat with messages
export const needsFreshPlanChatAtom = atom<boolean>(false);
