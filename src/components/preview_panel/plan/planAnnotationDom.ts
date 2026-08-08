import type { PlanAnnotation } from "@/atoms/planAtoms";

export const PLAN_ANNOTATION_IGNORE_ATTRIBUTE = "data-plan-annotation-ignore";
export const ANNOTATION_ID_ATTRIBUTE = "data-annotation-id";
export const ANNOTATION_MARK_SELECTOR = `mark[${ANNOTATION_ID_ATTRIBUTE}]`;

const PLAN_ANNOTATION_IGNORE_SELECTOR = `[${PLAN_ANNOTATION_IGNORE_ATTRIBUTE}]`;

interface PlanTextSegment {
  node: Text;
  startOffset: number;
  endOffset: number;
}

export interface PlanSelectionSnapshot {
  selectedText: string;
  startOffset: number;
  selectionLength: number;
}

function collectPlanTextSegments(container: HTMLElement): PlanTextSegment[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const textNode = node as Text;
      const text = textNode.textContent ?? "";
      const parent = textNode.parentElement;

      if (!parent || text.length === 0) {
        return NodeFilter.FILTER_REJECT;
      }

      if (parent.closest(PLAN_ANNOTATION_IGNORE_SELECTOR)) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const segments: PlanTextSegment[] = [];
  let currentOffset = 0;
  let node: Text | null;

  while ((node = walker.nextNode() as Text | null)) {
    const textLength = node.textContent?.length ?? 0;
    segments.push({
      node,
      startOffset: currentOffset,
      endOffset: currentOffset + textLength,
    });
    currentOffset += textLength;
  }

  return segments;
}

/**
 * Maps a DOM selection boundary (node + offset) to a flat character offset
 * within the plan's concatenated text content.
 *
 * Creates a temporary Range from the container start to the boundary point,
 * then walks the pre-collected text segments to find which segment contains
 * the boundary. This Range-based approach correctly handles boundaries that
 * land inside element nodes (not just text nodes) and accounts for ignored
 * regions (e.g. annotation marks) that are excluded from the segment list.
 */
function getBoundaryTextOffset(
  container: HTMLElement,
  boundaryNode: Node,
  boundaryOffset: number,
  segments: PlanTextSegment[],
): number | null {
  if (!container.contains(boundaryNode)) {
    return null;
  }

  const boundaryRange = document.createRange();
  boundaryRange.selectNodeContents(container);

  try {
    boundaryRange.setEnd(boundaryNode, boundaryOffset);
  } catch {
    return null;
  }

  let offset = 0;

  for (const segment of segments) {
    if (!boundaryRange.intersectsNode(segment.node)) {
      continue;
    }

    if (boundaryRange.endContainer === segment.node) {
      return segment.startOffset + boundaryRange.endOffset;
    }

    offset = segment.endOffset;
  }

  return offset;
}

function readPlanTextFromSegments(
  segments: PlanTextSegment[],
  startOffset: number,
  selectionLength: number,
): string | null {
  if (selectionLength <= 0 || startOffset < 0) {
    return null;
  }

  const endOffset = startOffset + selectionLength;
  let text = "";

  for (const segment of segments) {
    if (segment.endOffset <= startOffset) {
      continue;
    }

    if (segment.startOffset >= endOffset) {
      break;
    }

    const startInNode = Math.max(0, startOffset - segment.startOffset);
    const endInNode = Math.min(
      segment.node.textContent?.length ?? 0,
      endOffset - segment.startOffset,
    );

    if (startInNode >= endInNode) {
      continue;
    }

    text += segment.node.data.slice(startInNode, endInNode);
  }

  return text.length === selectionLength ? text : null;
}

function highlightAtOffset(
  segments: PlanTextSegment[],
  startOffset: number,
  selectionLength: number,
  annotationId: string,
  selectedText: string,
) {
  if (selectionLength <= 0) {
    return;
  }

  const endOffset = startOffset + selectionLength;
  const overlappingSegments = segments.filter(
    ({ startOffset: segmentStart, endOffset: segmentEnd }) =>
      segmentStart < endOffset && segmentEnd > startOffset,
  );

  // Iterate in reverse so that splitText mutations don't shift offsets
  // of earlier (not-yet-processed) segments.
  for (let index = overlappingSegments.length - 1; index >= 0; index--) {
    const segment = overlappingSegments[index];
    const { node: textNode } = segment;
    const startInNode = Math.max(0, startOffset - segment.startOffset);
    const endInNode = Math.min(
      textNode.textContent?.length ?? 0,
      endOffset - segment.startOffset,
    );
    const charsToHighlight = endInNode - startInNode;

    if (charsToHighlight <= 0 || !textNode.parentNode) {
      continue;
    }

    const highlightNode = textNode.splitText(startInNode);
    highlightNode.splitText(charsToHighlight);

    const mark = document.createElement("mark");
    const isFirstFragment = index === 0;
    mark.setAttribute(ANNOTATION_ID_ATTRIBUTE, annotationId);

    if (isFirstFragment) {
      const normalizedSelectedText = selectedText.replace(/\s+/g, " ").trim();
      mark.setAttribute("role", "button");
      mark.setAttribute("tabindex", "0");
      mark.setAttribute("aria-haspopup", "dialog");
      mark.setAttribute(
        "aria-label",
        normalizedSelectedText.length === 0
          ? "View comment"
          : `View comment for ${normalizedSelectedText}`,
      );
    } else {
      mark.setAttribute("tabindex", "-1");
      mark.setAttribute("aria-hidden", "true");
    }

    mark.className =
      "bg-yellow-400/25 text-inherit cursor-pointer rounded-sm px-0.5 border-b border-yellow-400/50";
    mark.textContent = highlightNode.textContent;

    const parent = highlightNode.parentNode;
    if (!parent) {
      continue;
    }

    parent.replaceChild(mark, highlightNode);
  }
}

export function getPlanSelectionSnapshot(
  container: HTMLElement,
  range: Range,
): PlanSelectionSnapshot | null {
  if (range.collapsed || !container.contains(range.commonAncestorContainer)) {
    return null;
  }

  const segments = collectPlanTextSegments(container);
  if (segments.length === 0) {
    return null;
  }

  const rawStartOffset = getBoundaryTextOffset(
    container,
    range.startContainer,
    range.startOffset,
    segments,
  );
  const rawEndOffset = getBoundaryTextOffset(
    container,
    range.endContainer,
    range.endOffset,
    segments,
  );

  if (rawStartOffset === null || rawEndOffset === null) {
    return null;
  }

  const rawSelectionLength = rawEndOffset - rawStartOffset;
  if (rawSelectionLength <= 0) {
    return null;
  }

  const rawSelectedText = readPlanTextFromSegments(
    segments,
    rawStartOffset,
    rawSelectionLength,
  );
  if (!rawSelectedText) {
    return null;
  }

  const leadingWhitespace =
    rawSelectedText.length - rawSelectedText.trimStart().length;
  const trailingWhitespace =
    rawSelectedText.length - rawSelectedText.trimEnd().length;
  const selectedText = rawSelectedText.trim();

  if (selectedText.length === 0) {
    return null;
  }

  return {
    selectedText,
    startOffset: rawStartOffset + leadingWhitespace,
    selectionLength:
      rawSelectionLength - leadingWhitespace - trailingWhitespace,
  };
}

export function hasOverlappingPlanAnnotation(
  annotations: PlanAnnotation[],
  startOffset: number,
  selectionLength: number,
): boolean {
  const endOffset = startOffset + selectionLength;

  return annotations.some((annotation) => {
    const annotationEnd = annotation.startOffset + annotation.selectionLength;
    return startOffset < annotationEnd && annotation.startOffset < endOffset;
  });
}

export function clearPlanAnnotationHighlights(container: HTMLElement) {
  container.querySelectorAll(ANNOTATION_MARK_SELECTOR).forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) {
      return;
    }

    parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
    parent.normalize();
  });
}

export function applyPlanAnnotationHighlights(
  container: HTMLElement,
  annotations: PlanAnnotation[],
) {
  const segments = collectPlanTextSegments(container);
  if (segments.length === 0) {
    return;
  }

  const totalTextLength = segments[segments.length - 1]?.endOffset ?? 0;

  const renderableAnnotations = [...annotations]
    .filter((annotation) => {
      if (annotation.selectionLength <= 0 || annotation.startOffset < 0) {
        return false;
      }

      if (
        annotation.startOffset + annotation.selectionLength >
        totalTextLength
      ) {
        return false;
      }

      const actualText = readPlanTextFromSegments(
        segments,
        annotation.startOffset,
        annotation.selectionLength,
      );

      return actualText === annotation.selectedText;
    })
    .sort(
      (left, right) =>
        left.startOffset - right.startOffset ||
        right.selectionLength - left.selectionLength,
    );

  const nonOverlappingAnnotations: PlanAnnotation[] = [];
  let previousEndOffset = -1;

  for (const annotation of renderableAnnotations) {
    if (annotation.startOffset < previousEndOffset) {
      continue;
    }

    nonOverlappingAnnotations.push(annotation);
    previousEndOffset = annotation.startOffset + annotation.selectionLength;
  }

  // Iterate in reverse so that DOM mutations from highlightAtOffset don't
  // invalidate offsets of earlier (not-yet-processed) annotations.
  for (let index = nonOverlappingAnnotations.length - 1; index >= 0; index--) {
    const annotation = nonOverlappingAnnotations[index];
    highlightAtOffset(
      segments,
      annotation.startOffset,
      annotation.selectionLength,
      annotation.id,
      annotation.selectedText,
    );
  }
}
