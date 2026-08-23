import type { PlanAnnotation } from "@/atoms/planAtoms";
import {
  ANNOTATION_IGNORE_ATTRIBUTE,
  createAnnotationDom,
  hasOverlappingAnnotation,
  type AnnotationSelectionSnapshot,
} from "@/lib/annotationDom";

export const PLAN_ANNOTATION_IGNORE_ATTRIBUTE = "data-plan-annotation-ignore";
export const ANNOTATION_ID_ATTRIBUTE = "data-annotation-id";

const planAnnotationDom = createAnnotationDom({
  idAttribute: ANNOTATION_ID_ATTRIBUTE,
  ignoreSelector: `[${PLAN_ANNOTATION_IGNORE_ATTRIBUTE}], [${ANNOTATION_IGNORE_ATTRIBUTE}]`,
  markClassName:
    "bg-yellow-400/25 text-inherit cursor-pointer rounded-sm px-0.5 border-b border-yellow-400/50",
  defaultLabel: (selectedText) =>
    selectedText.length === 0
      ? "View comment"
      : `View comment for ${selectedText}`,
});

export const ANNOTATION_MARK_SELECTOR = planAnnotationDom.markSelector;

export type PlanSelectionSnapshot = AnnotationSelectionSnapshot;

export function getPlanSelectionSnapshot(
  container: HTMLElement,
  range: Range,
): PlanSelectionSnapshot | null {
  return planAnnotationDom.getSelectionSnapshot(container, range);
}

export function hasOverlappingPlanAnnotation(
  annotations: PlanAnnotation[],
  startOffset: number,
  selectionLength: number,
): boolean {
  return hasOverlappingAnnotation(annotations, startOffset, selectionLength);
}

export function clearPlanAnnotationHighlights(container: HTMLElement) {
  planAnnotationDom.clearHighlights(container);
}

export function applyPlanAnnotationHighlights(
  container: HTMLElement,
  annotations: PlanAnnotation[],
) {
  planAnnotationDom.applyHighlights(container, annotations);
}
