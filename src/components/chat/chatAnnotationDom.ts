import type { ChatAnnotation } from "@/atoms/chatAnnotationAtoms";
import {
  ANNOTATION_IGNORE_ATTRIBUTE,
  createAnnotationDom,
  findOverlappingAnnotation,
  type AnnotationSelectionSnapshot,
} from "@/lib/annotationDom";
import { PLAN_ANNOTATION_IGNORE_ATTRIBUTE } from "../preview_panel/plan/planAnnotationDom";

export const CHAT_ANNOTATION_ID_ATTRIBUTE = "data-chat-annotation-id";

const chatAnnotationDom = createAnnotationDom({
  idAttribute: CHAT_ANNOTATION_ID_ATTRIBUTE,
  // `data-plan-annotation-ignore` predates the shared attribute and is still
  // what CodeHighlight stamps on the language/Copy toolbar, so honour both or
  // that chrome lands in the offset space and can be highlighted.
  ignoreSelector: `[${ANNOTATION_IGNORE_ATTRIBUTE}], [${PLAN_ANNOTATION_IGNORE_ATTRIBUTE}]`,
  markClassName:
    "bg-yellow-400/25 text-inherit cursor-pointer rounded-sm border-b border-yellow-400/60",
  defaultLabel: (selectedText) =>
    selectedText.length === 0
      ? "View comment"
      : `View comment for ${selectedText}`,
});

export const CHAT_ANNOTATION_MARK_SELECTOR = chatAnnotationDom.markSelector;

export type ChatSelectionSnapshot = AnnotationSelectionSnapshot;

export function getChatSelectionSnapshot(
  container: HTMLElement,
  range: Range,
): ChatSelectionSnapshot | null {
  return chatAnnotationDom.getSelectionSnapshot(container, range);
}

export function findOverlappingChatAnnotation(
  annotations: ChatAnnotation[],
  startOffset: number,
  selectionLength: number,
): ChatAnnotation | undefined {
  return findOverlappingAnnotation(annotations, startOffset, selectionLength);
}

export function clearChatAnnotationHighlights(container: HTMLElement) {
  chatAnnotationDom.clearHighlights(container);
}

export function applyChatAnnotationHighlights(
  container: HTMLElement,
  annotations: ChatAnnotation[],
  label?: (selectedText: string) => string,
) {
  chatAnnotationDom.applyHighlights(container, annotations, { label });
}
