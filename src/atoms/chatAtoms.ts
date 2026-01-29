import type {
  FileAttachment,
  Message,
  AgentTodo,
  ComponentSelection,
} from "@/ipc/types";
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
// Agent todos per chat
export const agentTodosByChatIdAtom = atom<Map<number, AgentTodo[]>>(new Map());
