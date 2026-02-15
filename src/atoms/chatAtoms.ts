import type {
  FileAttachment,
  Message,
  AgentTodo,
  ComponentSelection,
} from "@/ipc/types";
import type { Getter, Setter } from "jotai";
import type { PromptSuggestion } from "@/lib/schemas";
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
// Track chats opened in the current session - tabs are only shown for these
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
// Helper to add a chat ID to the session-opened set
function addToSessionSet(get: Getter, set: Setter, chatId: number): void {
  const sessionIds = get(sessionOpenedChatIdsAtom);
  if (!sessionIds.has(chatId)) {
    const newSessionIds = new Set(sessionIds);
    newSessionIds.add(chatId);
    set(sessionOpenedChatIdsAtom, newSessionIds);
  }
}
// Add a chat ID to the recent list only if it's not already present.
// Unlike pushRecentViewedChatIdAtom, this does NOT move existing IDs to the front,
// preserving the current tab order for chats already tracked.
// Also adds to session tracking so the tab appears in the tab bar.
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
    // Track in session so the tab appears
    addToSessionSet(get, set, chatId);
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
    // Track in session so the tab appears (fixes re-open after bulk close)
    addToSessionSet(get, set, chatId);
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
    // Also remove from session tracking (consistent with closeMultipleTabsAtom)
    removeFromSessionSet(get, set, [chatId]);
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
// Add a chat ID to the session-opened set (delegates to helper)
export const addSessionOpenedChatIdAtom = atom(
  null,
  (get, set, chatId: number) => addToSessionSet(get, set, chatId),
);
// Helper to remove chat IDs from the session-opened set
function removeFromSessionSet(
  get: Getter,
  set: Setter,
  chatIds: number[],
): void {
  const sessionIds = get(sessionOpenedChatIdsAtom);
  let changed = false;
  const newSessionIds = new Set(sessionIds);
  for (const id of chatIds) {
    if (newSessionIds.has(id)) {
      newSessionIds.delete(id);
      changed = true;
    }
  }
  if (changed) {
    set(sessionOpenedChatIdsAtom, newSessionIds);
  }
}
// Close multiple tabs at once (for "Close other tabs" / "Close tabs to the right")
export const closeMultipleTabsAtom = atom(
  null,
  (get, set, chatIdsToClose: number[]) => {
    if (chatIdsToClose.length === 0) return;

    // Remove from recent viewed
    const currentIds = get(recentViewedChatIdsAtom);
    const closeSet = new Set(chatIdsToClose);
    set(
      recentViewedChatIdsAtom,
      currentIds.filter((id) => !closeSet.has(id)),
    );

    // Add to closed set
    const closedIds = get(closedChatIdsAtom);
    const newClosedIds = new Set(closedIds);
    for (const id of chatIdsToClose) {
      newClosedIds.add(id);
    }
    set(closedChatIdsAtom, newClosedIds);

    // Remove from session tracking to prevent unbounded growth
    removeFromSessionSet(get, set, chatIdsToClose);
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
    // Also remove from session tracking
    removeFromSessionSet(get, set, [chatId]);
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

// Agent prompt suggestions per chat (set at end of turn, no DB needed)
export const agentPromptSuggestionsByChatIdAtom = atom<
  Map<number, PromptSuggestion[]>
>(new Map());

// Flag: set when user switches to plan mode from another mode in a chat with messages
export const needsFreshPlanChatAtom = atom<boolean>(false);

// Queued messages (multiple messages per chat, sent in sequence after streams complete)
export interface QueuedMessageItem {
  id: string; // UUID for stable identification during reordering/editing
  prompt: string;
  attachments?: FileAttachment[];
  selectedComponents?: ComponentSelection[];
}

// Map<chatId, QueuedMessageItem[]>
export const queuedMessagesByIdAtom = atom<Map<number, QueuedMessageItem[]>>(
  new Map(),
);

// Tracks whether the last stream for a chat completed successfully (via onEnd, not cancelled or errored)
// This is used to safely process the queue only when we're certain the stream finished normally
export const streamCompletedSuccessfullyByIdAtom = atom<Map<number, boolean>>(
  new Map(),
);
