import { atom } from "jotai";
import type { PlanQuestionnairePayload } from "@/ipc/types/plan";

/**
 * Represents the state for a single plan
 */
export interface PlanData {
  content: string;
  title: string;
  summary?: string;
}

/**
 * Unified plan state for all chats
 */
export interface PlanState {
  /** Plan data per chat (chatId -> PlanData) */
  plansByChatId: Map<number, PlanData>;
  /** Whether the user wants to persist the current plan */
  shouldPersist: boolean;
  /** Chat IDs where plans have been accepted */
  acceptedChatIds: Set<number>;
}

/**
 * Unified plan state atom
 */
export const planStateAtom = atom<PlanState>({
  plansByChatId: new Map(),
  shouldPersist: false,
  acceptedChatIds: new Set<number>(),
});

/**
 * Signals that we should start implementation with the accepted plan.
 * Set by usePlanEvents when plan is accepted, consumed by usePlanImplementation.
 */
export interface PendingPlanImplementation {
  chatId: number;
  title: string;
  plan: string;
  implementationNotes?: string;
}
export const pendingPlanImplementationAtom =
  atom<PendingPlanImplementation | null>(null);

/**
 * Stores the pending questionnaire payload per chat.
 * Used to render the questionnaire input above the chat.
 */
export const pendingQuestionnaireAtom = atom<PlanQuestionnairePayload | null>(
  null,
);
