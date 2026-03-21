import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { planAnnotationsAtom } from "@/atoms/planAtoms";
import {
  getPlanSelectionSnapshot,
  hasOverlappingPlanAnnotation,
} from "./planAnnotationDom";
import { getSelectionCommentAnchorRect } from "./selectionCommentButtonPosition";

interface FloatingButtonState {
  x: number;
  y: number;
  selectedText: string;
  startOffset: number;
  selectionLength: number;
}

interface SelectionCommentButtonProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  chatId: number;
}

export const SelectionCommentButton: React.FC<SelectionCommentButtonProps> = ({
  containerRef,
  scrollRef,
  chatId,
}) => {
  const annotations = useAtomValue(planAnnotationsAtom);
  const setAnnotations = useSetAtom(planAnnotationsAtom);
  const [floatingButton, setFloatingButton] =
    useState<FloatingButtonState | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [commentText, setCommentText] = useState("");
  const buttonRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const chatAnnotations = useMemo(
    () => annotations.get(chatId) ?? [],
    [annotations, chatId],
  );

  const clearState = useCallback(() => {
    setFloatingButton(null);
    setShowForm(false);
    setCommentText("");
  }, []);

  const handleCancel = useCallback(() => {
    setShowForm(false);
    setCommentText("");
  }, []);

  // Listen for text selection
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = (e: MouseEvent) => {
      // Ignore clicks on highlighted annotations (handled by CommentPopover)
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest("mark[data-annotation-id]")) return;

      // Small delay to let the selection finalize
      requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (
          !selection ||
          selection.rangeCount === 0 ||
          selection.toString().trim().length === 0
        ) {
          clearState();
          return;
        }

        // Ensure the selection is within the plan container
        const range = selection.getRangeAt(0);
        if (!container.contains(range.commonAncestorContainer)) {
          clearState();
          return;
        }
        const snapshot = getPlanSelectionSnapshot(container, range);
        if (!snapshot) {
          clearState();
          return;
        }

        if (
          hasOverlappingPlanAnnotation(
            chatAnnotations,
            snapshot.startOffset,
            snapshot.selectionLength,
          )
        ) {
          clearState();
          return;
        }

        const rect = getSelectionCommentAnchorRect(range);
        const formWidth = 288; // w-72
        const x = Math.min(rect.right + 4, window.innerWidth - formWidth - 8);
        const y = Math.max(rect.top - 4, 8);
        setShowForm(false);
        setCommentText("");
        setFloatingButton({
          x,
          y,
          selectedText: snapshot.selectedText,
          startOffset: snapshot.startOffset,
          selectionLength: snapshot.selectionLength,
        });
      });
    };

    container.addEventListener("mouseup", handleMouseUp);
    return () => container.removeEventListener("mouseup", handleMouseUp);
  }, [chatAnnotations, clearState, containerRef]);

  // Hide on scroll
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || !floatingButton) return;

    const handleScroll = () => {
      if (!showForm) {
        clearState();
      }
    };

    scrollEl.addEventListener("scroll", handleScroll);
    return () => scrollEl.removeEventListener("scroll", handleScroll);
  }, [scrollRef, floatingButton, showForm, clearState]);

  // Dismiss on click outside or Escape
  useEffect(() => {
    if (!floatingButton) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (formRef.current?.contains(target)) return;
      clearState();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearState();
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [floatingButton, clearState]);

  const handleCommentClick = () => {
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!commentText.trim() || !floatingButton) return;

    const annotation = {
      id: crypto.randomUUID(),
      chatId,
      selectedText: floatingButton.selectedText,
      comment: commentText.trim(),
      createdAt: Date.now(),
      startOffset: floatingButton.startOffset,
      selectionLength: floatingButton.selectionLength,
    };

    setAnnotations((prev) => {
      const next = new Map(prev);
      const list = next.get(chatId) ?? [];
      next.set(chatId, [...list, annotation]);
      return next;
    });

    clearState();
    window.getSelection()?.removeAllRanges();
  };

  if (!floatingButton) return null;

  return (
    <>
      {!showForm && (
        <div
          ref={buttonRef}
          style={{
            position: "fixed",
            left: floatingButton.x,
            top: floatingButton.y,
            zIndex: 50,
          }}
        >
          <button
            onClick={handleCommentClick}
            aria-label="Add comment"
            className="p-1.5 rounded-md bg-primary text-primary-foreground shadow-md hover:bg-primary/90 transition-colors"
          >
            <MessageSquare size={14} />
          </button>
        </div>
      )}

      {showForm && (
        <div
          ref={formRef}
          role="dialog"
          aria-label="Add comment on selected text"
          style={{
            position: "fixed",
            left: floatingButton.x,
            top: floatingButton.y,
            zIndex: 50,
          }}
          className="w-72 rounded-lg border bg-popover p-3 shadow-lg space-y-2"
        >
          <blockquote className="text-xs text-muted-foreground border-l-2 border-muted-foreground/30 pl-2 italic line-clamp-3">
            {floatingButton.selectedText}
          </blockquote>
          <textarea
            autoFocus
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add your comment..."
            className="w-full text-sm min-h-[60px] rounded-md border bg-background px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex items-center justify-end">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={!commentText.trim()}
              >
                Add Comment
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
