import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSetAtom } from "jotai";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { planAnnotationsAtom } from "@/atoms/planAtoms";

interface FloatingButtonState {
  x: number;
  y: number;
  selectedText: string;
}

interface SelectionCommentButtonProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  chatId: number;
}

export const SelectionCommentButton: React.FC<SelectionCommentButtonProps> = ({
  containerRef,
  chatId,
}) => {
  const setAnnotations = useSetAtom(planAnnotationsAtom);
  const [floatingButton, setFloatingButton] =
    useState<FloatingButtonState | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [commentText, setCommentText] = useState("");
  const buttonRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const clearState = useCallback(() => {
    setFloatingButton(null);
    setShowForm(false);
    setCommentText("");
  }, []);

  // Listen for text selection
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = () => {
      // Small delay to let the selection finalize
      requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (!selection || selection.toString().trim().length === 0) return;

        // Ensure the selection is within the plan container
        const range = selection.getRangeAt(0);
        if (!container.contains(range.commonAncestorContainer)) return;

        const rect = range.getBoundingClientRect();
        setFloatingButton({
          x: rect.right + 4,
          y: rect.top - 4,
          selectedText: selection.toString().trim(),
        });
        setShowForm(false);
        setCommentText("");
      });
    };

    container.addEventListener("mouseup", handleMouseUp);
    return () => container.removeEventListener("mouseup", handleMouseUp);
  }, [containerRef]);

  // Hide on scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !floatingButton) return;

    const handleScroll = () => {
      if (!showForm) clearState();
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [containerRef, floatingButton, showForm, clearState]);

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
            className="p-1.5 rounded-md bg-primary text-primary-foreground shadow-md hover:bg-primary/90 transition-colors"
          >
            <MessageSquare size={14} />
          </button>
        </div>
      )}

      {showForm && (
        <div
          ref={formRef}
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
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                handleSubmit();
              }
            }}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!commentText.trim()}
            >
              Add Comment
            </Button>
          </div>
        </div>
      )}
    </>
  );
};
