import { useAtom } from "jotai";
import { MessageSquare, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  addChatAnnotation,
  chatAnnotationsAtom,
  hasOverlappingChatAnnotation,
  removeChatAnnotation,
  updateChatAnnotation,
} from "@/atoms/chatAnnotationAtoms";
import { Button } from "@/components/ui/button";
import {
  applyChatAnnotationHighlights,
  CHAT_ANNOTATION_ID_ATTRIBUTE,
  CHAT_ANNOTATION_MARK_SELECTOR,
  clearChatAnnotationHighlights,
  getChatSelectionSnapshot,
} from "./chatAnnotationDom";

interface FloatingSelection {
  x: number;
  y: number;
  selectedText: string;
  startOffset: number;
  selectionLength: number;
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
  const annotations = useMemo(
    () =>
      (allAnnotations.get(chatId) ?? []).filter(
        (annotation) => annotation.messageId === messageId,
      ),
    [allAnnotations, chatId, messageId],
  );
  const [floating, setFloating] = useState<FloatingSelection | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const popoverRef = useRef<HTMLElement | null>(null);
  const setPopoverRef = useCallback((node: HTMLElement | null) => {
    popoverRef.current = node;
  }, []);

  const dismiss = useCallback(() => {
    setFloating(null);
    setActiveId(null);
    setComment("");
    setShowEditor(false);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    clearChatAnnotationHighlights(container);
    applyChatAnnotationHighlights(container, annotations);
    return () => clearChatAnnotationHighlights(container);
  }, [annotations, containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const openMark = (mark: HTMLElement) => {
      const id = mark.getAttribute(CHAT_ANNOTATION_ID_ATTRIBUTE);
      const annotation = annotations.find((item) => item.id === id);
      if (!annotation) return;
      const rect = mark.getBoundingClientRect();
      setFloating({
        x: Math.min(rect.right + 6, window.innerWidth - 304),
        y: Math.max(8, rect.top),
        selectedText: annotation.selectedText,
        startOffset: annotation.startOffset,
        selectionLength: annotation.selectionLength,
      });
      setActiveId(annotation.id);
      setComment(annotation.comment);
      setShowEditor(true);
    };

    const handleMouseUp = (event: MouseEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const mark = target?.closest(
        CHAT_ANNOTATION_MARK_SELECTOR,
      ) as HTMLElement | null;
      if (mark) {
        openMark(mark);
        return;
      }

      requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
          return;
        }
        const range = selection.getRangeAt(0);
        const snapshot = getChatSelectionSnapshot(container, range);
        if (
          !snapshot ||
          hasOverlappingChatAnnotation(
            annotations,
            snapshot.startOffset,
            snapshot.selectionLength,
          )
        ) {
          return;
        }
        const rects = range.getClientRects();
        const rect =
          rects.item(rects.length - 1) ?? range.getBoundingClientRect();
        setFloating({
          x: Math.max(8, Math.min(rect.right + 6, window.innerWidth - 304)),
          y: Math.max(8, Math.min(rect.top, window.innerHeight - 180)),
          ...snapshot,
        });
        setActiveId(null);
        setComment("");
        setShowEditor(false);
      });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const mark = target?.closest(
        CHAT_ANNOTATION_MARK_SELECTOR,
      ) as HTMLElement | null;
      if (mark && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        openMark(mark);
      }
    };

    container.addEventListener("mouseup", handleMouseUp);
    container.addEventListener("keydown", handleKeyDown);
    return () => {
      container.removeEventListener("mouseup", handleMouseUp);
      container.removeEventListener("keydown", handleKeyDown);
    };
  }, [annotations, containerRef]);

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
