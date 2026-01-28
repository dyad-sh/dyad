import { atom } from "jotai";

/**
 * Stores the current plan content per chat (chatId -> markdown content)
 */
export const planContentByChatIdAtom = atom<Map<number, string>>(new Map());

/**
 * Stores the plan title per chat (chatId -> title)
 */
export const planTitleByChatIdAtom = atom<Map<number, string>>(new Map());

/**
 * Stores the plan summary per chat (chatId -> summary)
 */
export const planSummaryByChatIdAtom = atom<Map<number, string>>(new Map());

/**
 * Whether the user wants to persist the current plan to database
 */
export const planShouldPersistAtom = atom<boolean>(false);

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
import type { PlanQuestionnairePayload } from "@/ipc/types/plan";
export const pendingQuestionnaireAtom = atom<PlanQuestionnairePayload | null>(
  null,
);
