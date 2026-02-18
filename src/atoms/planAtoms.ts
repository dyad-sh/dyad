import { atom } from "jotai";
import type { PlanQuestionnairePayload } from "@/ipc/types/plan";

export interface PlanData {
  content: string;
  title: string;
  summary?: string;
}

export interface PlanState {
  plansByChatId: Map<number, PlanData>;
  acceptedChatIds: Set<number>;
  transitioningChatIds: Set<number>;
}

export const planStateAtom = atom<PlanState>({
  plansByChatId: new Map(),
  acceptedChatIds: new Set<number>(),
  transitioningChatIds: new Set<number>(),
});

export interface PendingPlanImplementation {
  chatId: number;
  title: string;
  planSlug: string;
}

export const pendingPlanImplementationAtom =
  atom<PendingPlanImplementation | null>(null);

export const pendingQuestionnaireAtom = atom<
  Map<number, PlanQuestionnairePayload>
>(new Map());

// Transient flag: chatIds that just had a questionnaire submitted (for brief confirmation)
// "visible" = showing, "fading" = fade-out in progress
export const questionnaireSubmittedChatIdsAtom = atom<
  Map<number, "visible" | "fading">
>(new Map());
