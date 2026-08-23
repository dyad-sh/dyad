import { useAtom } from "jotai";
import { MessageSquare, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  addChatAnnotation,
  chatAnnotationsAtom,
  removeChatAnnotation,
  updateChatAnnotation,
  type ChatAnnotation,
} from "@/atoms/chatAnnotationAtoms";
import { Button } from "@/components/ui/button";
import {
  applyChatAnnotationHighlights,
  CHAT_ANNOTATION_ID_ATTRIBUTE,
  CHAT_ANNOTATION_MARK_SELECTOR,
  clearChatAnnotationHighlights,
  findOverlappingChatAnnotation,
  getChatSelectionSnapshot,
} from "./chatAnnotationDom";

const POPOVER_WIDTH = 296;
const POPOVER_HEIGHT = 180;

interface FloatingSelection {
  x: number;
  y: number;
  selectedText: string;
  startOffset: number;
  selectionLength: number;
}

/** Where the popover is pinned, so it can be repositioned as the page moves. */
type FloatingAnchor = { kind: "mark"; id: string } | { kind: "range" };

/** First `<mark>` fragment of an annotation, which carries its popover anchor. */
function findAnnotationMark(container: HTMLElement, annotationId: string) {
  return [
    ...container.querySelectorAll<HTMLElement>(CHAT_ANNOTATION_MARK_SELECTOR),
  ].find(
    (mark) => mark.getAttribute(CHAT_ANNOTATION_ID_ATTRIBUTE) === annotationId,
  );
}

function clampToViewport(rect: DOMRect): { x: number; y: number } {
  return {
    x: Math.max(
      8,
      Math.min(rect.right + 6, window.innerWidth - POPOVER_WIDTH - 8),
    ),
    y: Math.max(8, Math.min(rect.top, window.innerHeight - POPOVER_HEIGHT - 8)),
  };
}

export function ChatMessageAnnotationLayer({
  containerRef,
  chatId,
  messageId,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  chatId: number;
  messageId: number;
}) {
  const { t } = useTranslation("chat");
  const [allAnnotations, setAllAnnotations] = useAtom(chatAnnotationsAtom);
  // Returning the previous array when this message's annotations are unchanged
  // keeps the highlight effect from clearing and re-applying every message's
  // marks whenever any annotation anywhere in the chat changes.
  const stableAnnotationsRef = useRef<ChatAnnotation[]>([]);
  const annotations = useMemo(() => {
    const next = (allAnnotations.get(chatId) ?? []).filter(
      (annotation) => annotation.messageId === messageId,
    );
    const previous = stableAnnotationsRef.current;
    if (
      previous.length === next.length &&
      previous.every((annotation, index) => annotation === next[index])
    ) {
      return previous;
    }
    stableAnnotationsRef.current = next;
    return next;
  }, [allAnnotations, chatId, messageId]);
  const [floating, setFloating] = useState<FloatingSelection | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const popoverRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<FloatingAnchor | null>(null);
  const setPopoverRef = useCallback((node: HTMLElement | null) => {
    popoverRef.current = node;
  }, []);

  const markLabel = useCallback(
    (selectedText: string) =>
      selectedText.length === 0
        ? t("annotations.viewComment")
        : t("annotations.viewCommentFor", { text: selectedText }),
    [t],
  );

  const dismiss = useCallback(() => {
    anchorRef.current = null;
    setFloating(null);
    setActiveId(null);
    setComment("");
    setShowEditor(false);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let frameId: number | null = null;
    let isApplyingHighlights = false;

    // Markdown content is re-rendered outside this effect's control (React
    // reconciles the subtree, CodeHighlight swaps its fallback `<pre>` for
    // Shiki once the highlighter loads), and either wipes the marks out. Watch
    // the container and re-apply instead of highlighting exactly once.
    const observer = new MutationObserver(() => {
      if (isApplyingHighlights) return;
      scheduleRefresh();
    });

    const refresh = () => {
      observer.disconnect();
      isApplyingHighlights = true;
      try {
        clearChatAnnotationHighlights(container);
        applyChatAnnotationHighlights(container, annotations, markLabel);
      } finally {
        isApplyingHighlights = false;
        observer.observe(container, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }
    };

    const scheduleRefresh = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        frameId = null;
        refresh();
      });
    };

    scheduleRefresh();
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      observer.disconnect();
      if (frameId !== null) cancelAnimationFrame(frameId);
      clearChatAnnotationHighlights(container);
    };
  }, [annotations, containerRef, markLabel]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const openAnnotation = (annotation: ChatAnnotation, rect: DOMRect) => {
      anchorRef.current = { kind: "mark", id: annotation.id };
      setFloating({
        ...clampToViewport(rect),
        selectedText: annotation.selectedText,
        startOffset: annotation.startOffset,
        selectionLength: annotation.selectionLength,
      });
      setActiveId(annotation.id);
      setComment(annotation.comment);
      setShowEditor(true);
    };

    const openMark = (mark: HTMLElement) => {
      const id = mark.getAttribute(CHAT_ANNOTATION_ID_ATTRIBUTE);
      const annotation = annotations.find((item) => item.id === id);
      if (!annotation) return;
      openAnnotation(annotation, mark.getBoundingClientRect());
    };

    const markFromEvent = (event: Event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      return (target?.closest(CHAT_ANNOTATION_MARK_SELECTOR) ??
        null) as HTMLElement | null;
    };

    const findMark = (annotationId: string) =>
      findAnnotationMark(container, annotationId);

    // Capture the click on the way down so a highlight sitting inside a
    // markdown link or a tool-card button opens the comment instead of also
    // following the link / running the card action.
    const handleClickCapture = (event: MouseEvent) => {
      const mark = markFromEvent(event);
      if (!mark) return;
      event.preventDefault();
      event.stopPropagation();
      openMark(mark);
    };

    const processSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return;
      }
      const range = selection.getRangeAt(0);
      const snapshot = getChatSelectionSnapshot(container, range);
      if (!snapshot) return;

      const overlapping = findOverlappingChatAnnotation(
        annotations,
        snapshot.startOffset,
        snapshot.selectionLength,
      );
      if (overlapping) {
        // Silently doing nothing here read as "the feature is broken". Open the
        // comment the selection collides with so the overlap is explained by
        // what appears on screen.
        const mark = findMark(overlapping.id);
        openAnnotation(overlapping, (mark ?? range).getBoundingClientRect());
        return;
      }

      const rects = range.getClientRects();
      const rect =
        rects.item(rects.length - 1) ?? range.getBoundingClientRect();
      anchorRef.current = { kind: "range" };
      setFloating({ ...clampToViewport(rect), ...snapshot });
      setActiveId(null);
      setComment("");
      setShowEditor(false);
    };

    let frameId: number | null = null;
    const scheduleProcessSelection = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        frameId = null;
        processSelection();
      });
    };

    const handleSelectionEnd = (event: Event) => {
      if (markFromEvent(event)) return;
      scheduleProcessSelection();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const mark = markFromEvent(event);
      if (mark && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        openMark(mark);
      }
    };

    // Keyboard (shift+arrow) and touch selections never fire `mouseup`, so
    // without this they could never reach the comment affordance. One layer is
    // mounted per assistant message, so bail on someone else's selection before
    // arming the debounce rather than after.
    let selectionChangeTimer: ReturnType<typeof setTimeout> | null = null;
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (
        !selection ||
        selection.rangeCount === 0 ||
        selection.isCollapsed ||
        !container.contains(selection.getRangeAt(0).commonAncestorContainer)
      ) {
        return;
      }
      if (selectionChangeTimer !== null) clearTimeout(selectionChangeTimer);
      selectionChangeTimer = setTimeout(() => {
        selectionChangeTimer = null;
        scheduleProcessSelection();
      }, 200);
    };

    container.addEventListener("click", handleClickCapture, true);
    container.addEventListener("mouseup", handleSelectionEnd);
    container.addEventListener("keydown", handleKeyDown);
    container.addEventListener("touchend", handleSelectionEnd);
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      container.removeEventListener("click", handleClickCapture, true);
      container.removeEventListener("mouseup", handleSelectionEnd);
      container.removeEventListener("keydown", handleKeyDown);
      container.removeEventListener("touchend", handleSelectionEnd);
      document.removeEventListener("selectionchange", handleSelectionChange);
      if (frameId !== null) cancelAnimationFrame(frameId);
      if (selectionChangeTimer !== null) clearTimeout(selectionChangeTimer);
    };
  }, [annotations, containerRef]);

  // The popover is `position: fixed`, so it has to be re-pinned to its anchor
  // whenever the transcript scrolls or the window resizes - otherwise it stays
  // at stale viewport coordinates, floating over unrelated messages or landing
  // off-screen.
  useEffect(() => {
    if (!floating) return;
    const container = containerRef.current;

    const reposition = () => {
      const anchor = anchorRef.current;
      if (!anchor || !container) return;

      let rect: DOMRect | null = null;
      if (anchor.kind === "mark") {
        rect =
          findAnnotationMark(container, anchor.id)?.getBoundingClientRect() ??
          null;
      } else {
        const selection = window.getSelection();
        rect =
          selection && selection.rangeCount > 0
            ? selection.getRangeAt(0).getBoundingClientRect()
            : null;
      }

      if (!rect || (rect.width === 0 && rect.height === 0)) {
        dismiss();
        return;
      }

      const { x, y } = clampToViewport(rect);
      setFloating((previous) =>
        previous && (previous.x !== x || previous.y !== y)
          ? { ...previous, x, y }
          : previous,
      );
    };

    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [containerRef, dismiss, floating]);

  useEffect(() => {
    if (!floating) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) dismiss();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dismiss, floating]);

  if (!floating) return null;

  const save = () => {
    if (!comment.trim()) return;
    if (activeId) {
      setAllAnnotations((previous) =>
        updateChatAnnotation(previous, chatId, activeId, comment),
      );
    } else {
      setAllAnnotations((previous) =>
        addChatAnnotation(previous, {
          id: crypto.randomUUID(),
          chatId,
          messageId,
          selectedText: floating.selectedText,
          comment: comment.trim(),
          createdAt: Date.now(),
          startOffset: floating.startOffset,
          selectionLength: floating.selectionLength,
        }),
      );
    }
    window.getSelection()?.removeAllRanges();
    dismiss();
  };

  if (!showEditor) {
    return (
      <button
        ref={setPopoverRef}
        type="button"
        aria-label={t("annotations.commentOnSelection")}
        className="fixed z-50 flex size-8 animate-in items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md ring-offset-background transition duration-150 ease-out fade-in-0 zoom-in-95 hover:bg-primary/90 hover:shadow-lg active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:animate-none motion-reduce:transition-none"
        style={{ left: floating.x, top: floating.y }}
        onClick={() => setShowEditor(true)}
      >
        <MessageSquare className="size-4" />
      </button>
    );
  }

  return (
    <div
      ref={setPopoverRef}
      role="dialog"
      aria-label={
        activeId
          ? t("annotations.editComment")
          : t("annotations.commentOnSelection")
      }
      className="fixed z-50 flex w-72 animate-in flex-col gap-1 rounded-2xl border border-border/70 bg-popover p-1.5 text-popover-foreground shadow-xl duration-150 ease-out fade-in-0 zoom-in-95 focus-within:ring-2 focus-within:ring-ring/30 motion-reduce:animate-none"
      style={{ left: floating.x, top: floating.y }}
    >
      <textarea
        autoFocus
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) save();
        }}
        placeholder={t("annotations.addCommentPlaceholder")}
        className="min-h-16 w-full resize-none rounded-xl bg-transparent px-2.5 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center justify-between gap-2">
        {activeId ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label={t("annotations.deleteComment")}
            onClick={() => {
              setAllAnnotations((previous) =>
                removeChatAnnotation(previous, chatId, activeId),
              );
              dismiss();
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full text-muted-foreground hover:text-foreground"
            onClick={dismiss}
          >
            {t("annotations.cancel")}
          </Button>
          <Button
            size="sm"
            className="rounded-full px-4"
            disabled={!comment.trim()}
            onClick={save}
          >
            {activeId ? t("annotations.save") : t("annotations.addComment")}
          </Button>
        </div>
      </div>
    </div>
  );
}
