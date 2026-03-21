import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CommentCard } from "./CommentCard";
import type { PlanAnnotation } from "@/atoms/planAtoms";

interface PopoverState {
  annotationId: string;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
}

interface CommentPopoverProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  chatId: number;
  annotations: PlanAnnotation[];
}

export const CommentPopover: React.FC<CommentPopoverProps> = ({
  containerRef,
  scrollRef,
  chatId,
  annotations,
}) => {
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const dismiss = useCallback(
    ({ restoreFocus = false }: { restoreFocus?: boolean } = {}) => {
      setPopover(null);

      if (restoreFocus) {
        const trigger = triggerRef.current;
        if (trigger?.isConnected) {
          requestAnimationFrame(() => {
            trigger.focus();
          });
        }
      }
    },
    [],
  );

  const openPopoverForMark = useCallback((mark: HTMLElement) => {
    const annotationId = mark.getAttribute("data-annotation-id");
    if (!annotationId) return;

    const rect = mark.getBoundingClientRect();
    triggerRef.current = mark;
    setPopover({
      annotationId,
      anchorX: rect.right + 8,
      anchorY: rect.top,
      x: rect.right + 8,
      y: rect.top,
    });
  }, []);

  // Listen for clicks on highlighted marks
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const mark = target?.closest("mark[data-annotation-id]") as HTMLElement;
      if (!mark) return;

      openPopoverForMark(mark);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") {
        return;
      }

      const target = e.target instanceof HTMLElement ? e.target : null;
      const mark = target?.closest("mark[data-annotation-id]") as HTMLElement;
      if (!mark) return;

      e.preventDefault();
      openPopoverForMark(mark);
    };

    container.addEventListener("click", handleClick);
    container.addEventListener("keydown", handleKeyDown);
    return () => {
      container.removeEventListener("click", handleClick);
      container.removeEventListener("keydown", handleKeyDown);
    };
  }, [containerRef, openPopoverForMark]);

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
      if (e.key === "Escape") dismiss({ restoreFocus: true });
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [popover, dismiss]);

  // Dismiss on scroll
  useEffect(() => {
    const scrollEl = scrollRef?.current;
    if (!scrollEl || !popover) return;

    const handleScroll = () => dismiss();
    scrollEl.addEventListener("scroll", handleScroll);
    return () => scrollEl.removeEventListener("scroll", handleScroll);
  }, [scrollRef, popover, dismiss]);

  // Dismiss when annotations change (e.g., deleted)
  useEffect(() => {
    if (popover && !annotations.find((a) => a.id === popover.annotationId)) {
      dismiss();
    }
  }, [annotations, popover, dismiss]);

  useLayoutEffect(() => {
    if (!popover || !popoverRef.current) return;

    const updatePosition = () => {
      const popoverElement = popoverRef.current;
      if (!popoverElement) return;

      const rect = popoverElement.getBoundingClientRect();
      const margin = 8;
      const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
      const maxY = Math.max(margin, window.innerHeight - rect.height - margin);
      const nextX = Math.max(margin, Math.min(popover.anchorX, maxX));
      const nextY = Math.max(margin, Math.min(popover.anchorY, maxY));

      setPopover((current) => {
        if (!current || current.annotationId !== popover.annotationId) {
          return current;
        }

        if (current.x === nextX && current.y === nextY) {
          return current;
        }

        return { ...current, x: nextX, y: nextY };
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [popover?.annotationId, popover?.anchorX, popover?.anchorY]);

  useEffect(() => {
    if (!popover || !popoverRef.current) return;

    const firstFocusable = popoverRef.current.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );

    (firstFocusable ?? popoverRef.current).focus();
  }, [popover]);

  if (!popover) return null;

  const annotation = annotations.find((a) => a.id === popover.annotationId);
  if (!annotation) return null;

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Comment on selected text"
      tabIndex={-1}
      style={{
        position: "fixed",
        left: popover.x,
        top: popover.y,
        zIndex: 50,
      }}
      className="w-72 rounded-lg border bg-popover shadow-lg"
    >
      <CommentCard annotation={annotation} chatId={chatId} />
    </div>
  );
};
