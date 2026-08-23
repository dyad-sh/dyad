import type { ChatAnnotation } from "@/atoms/chatAnnotationAtoms";

export const CHAT_ANNOTATION_ID_ATTRIBUTE = "data-chat-annotation-id";
export const CHAT_ANNOTATION_MARK_SELECTOR = `mark[${CHAT_ANNOTATION_ID_ATTRIBUTE}]`;
const IGNORE_SELECTOR = "[data-chat-annotation-ignore]";

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

export interface ChatSelectionSnapshot {
  selectedText: string;
  startOffset: number;
  selectionLength: number;
}

function collectSegments(container: HTMLElement): TextSegment[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = (node as Text).parentElement;
      return parent && node.textContent && !parent.closest(IGNORE_SELECTOR)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const segments: TextSegment[] = [];
  let offset = 0;
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const length = node.data.length;
    segments.push({ node, start: offset, end: offset + length });
    offset += length;
  }
  return segments;
}

function boundaryOffset(
  container: HTMLElement,
  boundaryNode: Node,
  boundaryNodeOffset: number,
  segments: TextSegment[],
): number | null {
  if (!container.contains(boundaryNode)) return null;
  const range = document.createRange();
  range.selectNodeContents(container);
  try {
    range.setEnd(boundaryNode, boundaryNodeOffset);
  } catch {
    return null;
  }
  let offset = 0;
  for (const segment of segments) {
    if (!range.intersectsNode(segment.node)) continue;
    if (range.endContainer === segment.node) {
      return segment.start + range.endOffset;
    }
    offset = segment.end;
  }
  return offset;
}

function readText(
  segments: TextSegment[],
  startOffset: number,
  selectionLength: number,
): string | null {
  if (startOffset < 0 || selectionLength <= 0) return null;
  const endOffset = startOffset + selectionLength;
  let result = "";
  for (const segment of segments) {
    if (segment.end <= startOffset) continue;
    if (segment.start >= endOffset) break;
    result += segment.node.data.slice(
      Math.max(0, startOffset - segment.start),
      Math.min(segment.node.data.length, endOffset - segment.start),
    );
  }
  return result.length === selectionLength ? result : null;
}

export function getChatSelectionSnapshot(
  container: HTMLElement,
  range: Range,
): ChatSelectionSnapshot | null {
  if (range.collapsed || !container.contains(range.commonAncestorContainer)) {
    return null;
  }
  const segments = collectSegments(container);
  const start = boundaryOffset(
    container,
    range.startContainer,
    range.startOffset,
    segments,
  );
  const end = boundaryOffset(
    container,
    range.endContainer,
    range.endOffset,
    segments,
  );
  if (start === null || end === null || end <= start) return null;
  const rawText = readText(segments, start, end - start);
  if (!rawText?.trim()) return null;
  const leading = rawText.length - rawText.trimStart().length;
  const trailing = rawText.length - rawText.trimEnd().length;
  return {
    selectedText: rawText.trim(),
    startOffset: start + leading,
    selectionLength: end - start - leading - trailing,
  };
}

export function clearChatAnnotationHighlights(container: HTMLElement) {
  container.querySelectorAll(CHAT_ANNOTATION_MARK_SELECTOR).forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
    parent.normalize();
  });
}

export function applyChatAnnotationHighlights(
  container: HTMLElement,
  annotations: ChatAnnotation[],
) {
  const segments = collectSegments(container);
  const valid = [...annotations]
    .filter(
      (annotation) =>
        readText(
          segments,
          annotation.startOffset,
          annotation.selectionLength,
        ) === annotation.selectedText,
    )
    .sort((left, right) => right.startOffset - left.startOffset);

  for (const annotation of valid) {
    const endOffset = annotation.startOffset + annotation.selectionLength;
    const overlapping = segments.filter(
      (segment) =>
        segment.start < endOffset && segment.end > annotation.startOffset,
    );
    for (let index = overlapping.length - 1; index >= 0; index--) {
      const segment = overlapping[index];
      const start = Math.max(0, annotation.startOffset - segment.start);
      const end = Math.min(segment.node.data.length, endOffset - segment.start);
      const highlighted = segment.node.splitText(start);
      highlighted.splitText(end - start);
      const mark = document.createElement("mark");
      mark.setAttribute(CHAT_ANNOTATION_ID_ATTRIBUTE, annotation.id);
      mark.className =
        "bg-yellow-400/25 text-inherit cursor-pointer rounded-sm border-b border-yellow-400/60";
      mark.textContent = highlighted.textContent;
      if (index === 0) {
        mark.tabIndex = 0;
        mark.setAttribute("role", "button");
        mark.setAttribute("aria-label", `View comment for ${annotation.selectedText}`);
      } else {
        mark.tabIndex = -1;
        mark.setAttribute("aria-hidden", "true");
      }
      highlighted.parentNode?.replaceChild(mark, highlighted);
    }
  }
}
