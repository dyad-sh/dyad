/**
 * Shared DOM engine for text annotations (plan documents and chat messages).
 *
 * Both surfaces need the same three primitives: map a DOM selection to a flat
 * character offset in the rendered text, read the text back at a saved offset
 * to detect stale annotations, and wrap the matching text nodes in `<mark>`
 * elements. Keeping one implementation means offset-math fixes land on both
 * callers instead of drifting between two near-identical copies.
 */

/**
 * Marks a subtree as UI chrome that must stay out of the annotation offset
 * space (toolbars, collapsible tool cards, anything whose text can appear or
 * disappear without the message content changing).
 */
export const ANNOTATION_IGNORE_ATTRIBUTE = "data-annotation-ignore";

interface AnnotationTextSegment {
  node: Text;
  startOffset: number;
  endOffset: number;
}

export interface AnnotationSelectionSnapshot {
  selectedText: string;
  startOffset: number;
  selectionLength: number;
}

/** The subset of an annotation this module needs to render a highlight. */
export interface AnnotationRange {
  id: string;
  selectedText: string;
  startOffset: number;
  selectionLength: number;
}

export interface AnnotationDomConfig {
  /** Attribute stamped on each `<mark>` with the annotation id. */
  idAttribute: string;
  /** CSS selector matching subtrees excluded from the offset space. */
  ignoreSelector: string;
  /** Tailwind classes applied to each `<mark>`. */
  markClassName: string;
  /** Builds the accessible name of the first `<mark>` of an annotation. */
  defaultLabel: (selectedText: string) => string;
}

export interface ApplyHighlightsOptions {
  /**
   * Overrides `defaultLabel` for this call, so callers with access to i18n can
   * pass a translated accessible name instead of the module's fallback.
   */
  label?: (selectedText: string) => string;
}

/** The single overlap primitive; callers that only need a boolean compare to undefined. */
export function findOverlappingAnnotation<T extends AnnotationRange>(
  annotations: T[],
  startOffset: number,
  selectionLength: number,
): T | undefined {
  const endOffset = startOffset + selectionLength;

  return annotations.find((annotation) => {
    const annotationEnd = annotation.startOffset + annotation.selectionLength;
    return startOffset < annotationEnd && annotation.startOffset < endOffset;
  });
}

export function createAnnotationDom(config: AnnotationDomConfig) {
  const { idAttribute, ignoreSelector, markClassName, defaultLabel } = config;
  const markSelector = `mark[${idAttribute}]`;

  function collectTextSegments(
    container: HTMLElement,
  ): AnnotationTextSegment[] {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const textNode = node as Text;
        const parent = textNode.parentElement;

        if (!parent || textNode.data.length === 0) {
          return NodeFilter.FILTER_REJECT;
        }

        if (parent.closest(ignoreSelector)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const segments: AnnotationTextSegment[] = [];
    let currentOffset = 0;
    let node: Text | null;

    while ((node = walker.nextNode() as Text | null)) {
      const textLength = node.data.length;
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
   * within the container's concatenated text content.
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
    segments: AnnotationTextSegment[],
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

  function readTextFromSegments(
    segments: AnnotationTextSegment[],
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
        segment.node.data.length,
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
    segments: AnnotationTextSegment[],
    annotation: AnnotationRange,
    label: (selectedText: string) => string,
  ) {
    if (annotation.selectionLength <= 0) {
      return;
    }

    const endOffset = annotation.startOffset + annotation.selectionLength;
    const overlappingSegments = segments.filter(
      ({ startOffset: segmentStart, endOffset: segmentEnd }) =>
        segmentStart < endOffset && segmentEnd > annotation.startOffset,
    );

    // Iterate in reverse so that splitText mutations don't shift offsets
    // of earlier (not-yet-processed) segments.
    for (let index = overlappingSegments.length - 1; index >= 0; index--) {
      const segment = overlappingSegments[index];
      const { node: textNode } = segment;
      const startInNode = Math.max(
        0,
        annotation.startOffset - segment.startOffset,
      );
      const endInNode = Math.min(
        textNode.data.length,
        endOffset - segment.startOffset,
      );
      const charsToHighlight = endInNode - startInNode;

      if (charsToHighlight <= 0 || !textNode.parentNode) {
        continue;
      }

      const highlightNode = textNode.splitText(startInNode);
      highlightNode.splitText(charsToHighlight);

      const mark = document.createElement("mark");
      mark.setAttribute(idAttribute, annotation.id);
      mark.className = markClassName;
      mark.textContent = highlightNode.data;

      if (index === 0) {
        const normalizedSelectedText = annotation.selectedText
          .replace(/\s+/g, " ")
          .trim();
        mark.setAttribute("role", "button");
        mark.setAttribute("tabindex", "0");
        mark.setAttribute("aria-haspopup", "dialog");
        mark.setAttribute("aria-label", label(normalizedSelectedText));
      } else {
        // Continuation fragments stay in the accessibility tree: they hold
        // real message text, and hiding them would drop part of the message
        // for screen reader users just because it was annotated.
        mark.setAttribute("tabindex", "-1");
      }

      const parent = highlightNode.parentNode;
      if (!parent) {
        continue;
      }

      parent.replaceChild(mark, highlightNode);
    }
  }

  function getSelectionSnapshot(
    container: HTMLElement,
    range: Range,
  ): AnnotationSelectionSnapshot | null {
    if (range.collapsed || !container.contains(range.commonAncestorContainer)) {
      return null;
    }

    const segments = collectTextSegments(container);
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

    const rawSelectedText = readTextFromSegments(
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

  function clearHighlights(container: HTMLElement) {
    container.querySelectorAll(markSelector).forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) {
        return;
      }

      // Restore only the node this module created. `parent.normalize()` would
      // also merge adjacent text nodes the annotation never touched, and React
      // still holds references to those nodes for the markdown subtree it
      // rendered - merging them away makes a later update throw
      // NotFoundError on removeChild or write text into the wrong node.
      parent.replaceChild(
        document.createTextNode(mark.textContent ?? ""),
        mark,
      );
    });
  }

  function applyHighlights(
    container: HTMLElement,
    annotations: AnnotationRange[],
    options: ApplyHighlightsOptions = {},
  ) {
    const segments = collectTextSegments(container);
    if (segments.length === 0) {
      return;
    }

    const label = options.label ?? defaultLabel;
    const totalTextLength = segments[segments.length - 1]?.endOffset ?? 0;

    const renderableAnnotations = annotations
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

        return (
          readTextFromSegments(
            segments,
            annotation.startOffset,
            annotation.selectionLength,
          ) === annotation.selectedText
        );
      })
      .sort(
        (left, right) =>
          left.startOffset - right.startOffset ||
          right.selectionLength - left.selectionLength,
      );

    const nonOverlappingAnnotations: AnnotationRange[] = [];
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
    for (
      let index = nonOverlappingAnnotations.length - 1;
      index >= 0;
      index--
    ) {
      highlightAtOffset(segments, nonOverlappingAnnotations[index], label);
    }
  }

  return {
    idAttribute,
    markSelector,
    getSelectionSnapshot,
    clearHighlights,
    applyHighlights,
  };
}
