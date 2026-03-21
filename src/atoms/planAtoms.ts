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

export interface PlanAnnotation {
  id: string;
  chatId: number;
  selectedText: string;
  comment: string;
  createdAt: number;
  /** Character offset from the rendered plan text, excluding annotation UI chrome */
  startOffset: number;
  /** Length of the selected text in characters */
  selectionLength: number;
}

export const planAnnotationsAtom = atom<Map<number, PlanAnnotation[]>>(
  new Map(),
);

type AnnotationsMap = Map<number, PlanAnnotation[]>;

export function addPlanAnnotation(
  prev: AnnotationsMap,
  chatId: number,
  annotation: PlanAnnotation,
): AnnotationsMap {
  const next = new Map(prev);
  const list = next.get(chatId) ?? [];
  next.set(chatId, [...list, annotation]);
  return next;
}

export function updatePlanAnnotation(
  prev: AnnotationsMap,
  chatId: number,
  annotationId: string,
  comment: string,
): AnnotationsMap {
  const next = new Map(prev);
  const list = (next.get(chatId) ?? []).map((a) =>
    a.id === annotationId ? { ...a, comment } : a,
  );
  next.set(chatId, list);
  return next;
}

export function removePlanAnnotation(
  prev: AnnotationsMap,
  chatId: number,
  annotationId: string,
): AnnotationsMap {
  const next = new Map(prev);
  const list = next.get(chatId) ?? [];
  next.set(
    chatId,
    list.filter((a) => a.id !== annotationId),
  );
  return next;
}

export function clearPlanAnnotations(
  prev: AnnotationsMap,
  chatId: number,
): AnnotationsMap {
  const next = new Map(prev);
  next.delete(chatId);
  return next;
}

// Transient flag: chatIds that just had a questionnaire submitted (for brief confirmation)
// "visible" = showing, "fading" = fade-out in progress
export const questionnaireSubmittedChatIdsAtom = atom<
  Map<number, "visible" | "fading">
>(new Map());
