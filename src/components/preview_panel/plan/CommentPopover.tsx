import React, { useCallback, useEffect, useState } from "react";
import { CommentCard } from "./CommentCard";
import type { PlanAnnotation } from "@/atoms/planAtoms";

interface PopoverState {
  annotationId: string;
  x: number;
  y: number;
}

interface CommentPopoverProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  chatId: number;
  annotations: PlanAnnotation[];
}

export const CommentPopover: React.FC<CommentPopoverProps> = ({
  containerRef,
  chatId,
  annotations,
}) => {
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => setPopover(null), []);

  // Listen for clicks on highlighted marks
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const mark = target.closest("mark[data-annotation-id]") as HTMLElement;
      if (!mark) return;

      const annotationId = mark.getAttribute("data-annotation-id");
      if (!annotationId) return;

      const rect = mark.getBoundingClientRect();
      setPopover({
        annotationId,
        x: rect.right + 8,
        y: rect.top,
      });
    };

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [containerRef]);

  // Dismiss on click outside or Escape
  useEffect(() => {
    if (!popover) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      // Don't dismiss if clicking another mark (the click handler above will update)
      const el = e.target as HTMLElement;
      if (el.closest?.("mark[data-annotation-id]")) return;
      dismiss();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [popover, dismiss]);

  // Dismiss when annotations change (e.g., deleted)
  useEffect(() => {
    if (popover && !annotations.find((a) => a.id === popover.annotationId)) {
      dismiss();
    }
  }, [annotations, popover, dismiss]);

  if (!popover) return null;

  const annotation = annotations.find((a) => a.id === popover.annotationId);
  if (!annotation) return null;

  // Clamp position to stay within viewport
  const maxX = window.innerWidth - 320;
  const maxY = window.innerHeight - 200;
  const x = Math.min(popover.x, maxX);
  const y = Math.min(popover.y, maxY);

  return (
    <div
      ref={popoverRef}
      style={{
        position: "fixed",
        left: x,
        top: y,
        zIndex: 50,
      }}
      className="w-72 rounded-lg border bg-popover shadow-lg"
    >
      <CommentCard annotation={annotation} chatId={chatId} />
    </div>
  );
};
