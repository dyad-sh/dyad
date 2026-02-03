import { atom } from "jotai";
import type { PlanQuestionnairePayload } from "@/ipc/types/plan";

export interface PlanData {
  content: string;
  title: string;
  summary?: string;
}

export interface PlanState {
  plansByChatId: Map<number, PlanData>;
  persistChatIds: Set<number>;
  acceptedChatIds: Set<number>;
}

export const planStateAtom = atom<PlanState>({
  plansByChatId: new Map(),
  persistChatIds: new Set<number>(),
  acceptedChatIds: new Set<number>(),
});

export interface PendingPlanImplementation {
  chatId: number;
  title: string;
  plan: string;
  implementationNotes?: string;
}

export const pendingPlanImplementationAtom =
  atom<PendingPlanImplementation | null>(null);

export const pendingQuestionnaireAtom = atom<PlanQuestionnairePayload | null>(
  null,
);
