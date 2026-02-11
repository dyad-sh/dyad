import type { FileAttachment, Message, AgentTodo } from "@/ipc/types";
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
export const setRecentViewedChatIdsAtom = atom(
  null,
  (_get, set, chatIds: number[]) => {
    set(recentViewedChatIdsAtom, chatIds);
  },
);
export const pushRecentViewedChatIdAtom = atom(
  null,
  (get, set, chatId: number) => {
    const nextIds = get(recentViewedChatIdsAtom).filter((id) => id !== chatId);
    nextIds.unshift(chatId);
    set(recentViewedChatIdsAtom, nextIds);
    // Remove from closed set when explicitly selected
    const closedIds = get(closedChatIdsAtom);
    if (closedIds.has(chatId)) {
      const newClosedIds = new Set(closedIds);
      newClosedIds.delete(chatId);
      set(closedChatIdsAtom, newClosedIds);
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
// Remove a chat ID from all tracking (used when chat is deleted)
export const removeChatIdFromAllTrackingAtom = atom(
  null,
  (get, set, chatId: number) => {
    set(
      recentViewedChatIdsAtom,
      get(recentViewedChatIdsAtom).filter((id) => id !== chatId),
    );
    const closedIds = get(closedChatIdsAtom);
    if (closedIds.has(chatId)) {
      const newClosedIds = new Set(closedIds);
      newClosedIds.delete(chatId);
      set(closedChatIdsAtom, newClosedIds);
    }
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
