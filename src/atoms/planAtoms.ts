import { atom } from "jotai";
import type { UserInputQuestionPayload } from "@/ipc/types/user_input";
import {
  respondingRequestIdsAtom,
  userInputRequestsAtom,
} from "@/user_input/projection";

export interface PlanData {
  content: string;
  title: string;
  summary?: string;
}

// The transient "transitioning" display state is not tracked here: it is the
// plan-handoff machine's `transitioning` state (src/plan_handoff/), read via
// usePlanHandoffState.
export interface PlanState {
  plansByChatId: Map<number, PlanData>;
  acceptedChatIds: Set<number>;
}

export const planStateAtom = atom<PlanState>({
  plansByChatId: new Map(),
  acceptedChatIds: new Set<number>(),
});

// Records, per plan chatId, whether the user chose to implement in a brand-new
// chat (true) or to continue in the current chat (false) when accepting the
// plan. Read by the plan-handoff machine once the exit_plan event fires so it
// can route the implementation accordingly.
export const planAcceptInNewChatByChatIdAtom = atom<Map<number, boolean>>(
  new Map(),
);

interface PendingQuestionnaire {
  chatId: number;
  requestId: string;
  questions: UserInputQuestionPayload[];
  isResponding: boolean;
}

export const pendingQuestionnaireAtom = atom<Map<number, PendingQuestionnaire>>(
  (get) => {
    const questionnaires = new Map<number, PendingQuestionnaire>();
    const respondingRequestIds = get(respondingRequestIdsAtom);
    for (const request of get(userInputRequestsAtom).values()) {
      if (request.status === "settled") continue;
      const descriptor = request.descriptor;
      if (descriptor.kind !== "questionnaire") continue;
      questionnaires.set(descriptor.chatId, {
        chatId: descriptor.chatId,
        requestId: descriptor.requestId,
        questions: descriptor.questions,
        isResponding: respondingRequestIds.has(descriptor.requestId),
      });
    }
    return questionnaires;
  },
);

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
