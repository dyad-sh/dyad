import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CommentCard } from "./CommentCard";
import type { PlanAnnotation } from "@/atoms/planAtoms";
import {
  ANNOTATION_ID_ATTRIBUTE,
  ANNOTATION_MARK_SELECTOR,
} from "./planAnnotationDom";

interface PopoverState {
  annotationId: string;
  anchorX: number;
  anchorY: number;
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
    const annotationId = mark.getAttribute(ANNOTATION_ID_ATTRIBUTE);
    if (!annotationId) return;

    const rect = mark.getBoundingClientRect();
    triggerRef.current = mark;
    setPopover({
      annotationId,
      anchorX: rect.right + 8,
      anchorY: rect.top,
    });
  }, []);

  // Listen for clicks on highlighted marks
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const mark = target?.closest(ANNOTATION_MARK_SELECTOR) as HTMLElement;
      if (!mark) return;

      openPopoverForMark(mark);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") {
        return;
      }

      const target = e.target instanceof HTMLElement ? e.target : null;
      const mark = target?.closest(ANNOTATION_MARK_SELECTOR) as HTMLElement;
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
      if (el.closest?.(ANNOTATION_MARK_SELECTOR)) return;
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

  // Reposition on scroll; dismiss if anchor mark leaves viewport
  useEffect(() => {
    const scrollEl = scrollRef?.current;
    if (!scrollEl || !popover) return;

    const handleScroll = () => {
      const mark = containerRef.current?.querySelector<HTMLElement>(
        `mark[${ANNOTATION_ID_ATTRIBUTE}="${popover.annotationId}"]`,
      );
      if (!mark) {
        dismiss();
        return;
      }

      const rect = mark.getBoundingClientRect();
      const scrollRect = scrollEl.getBoundingClientRect();

      // Dismiss if the mark has scrolled completely out of the visible area
      if (rect.bottom < scrollRect.top || rect.top > scrollRect.bottom) {
        dismiss();
        return;
      }

      setPopover((current) => {
        if (!current || current.annotationId !== popover.annotationId)
          return current;
        return {
          ...current,
          anchorX: rect.right + 8,
          anchorY: rect.top,
        };
      });
    };

    scrollEl.addEventListener("scroll", handleScroll);
    return () => scrollEl.removeEventListener("scroll", handleScroll);
  }, [scrollRef, containerRef, popover?.annotationId, dismiss]);

  // Dismiss when annotations change (e.g., deleted)
  useEffect(() => {
    if (popover && !annotations.find((a) => a.id === popover.annotationId)) {
      dismiss();
    }
  }, [annotations, popover, dismiss]);

  useLayoutEffect(() => {
    if (!popover || !popoverRef.current) return;

    const clampPosition = () => {
      const popoverElement = popoverRef.current;
      if (!popoverElement) return;

      const rect = popoverElement.getBoundingClientRect();
      const margin = 8;
      const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
      const maxY = Math.max(margin, window.innerHeight - rect.height - margin);
      const clampedX = Math.max(margin, Math.min(popover.anchorX, maxX));
      const clampedY = Math.max(margin, Math.min(popover.anchorY, maxY));

      popoverElement.style.left = `${clampedX}px`;
      popoverElement.style.top = `${clampedY}px`;
    };

    clampPosition();
    window.addEventListener("resize", clampPosition);
    return () => window.removeEventListener("resize", clampPosition);
  }, [popover?.annotationId, popover?.anchorX, popover?.anchorY]);

  useEffect(() => {
    if (!popover || !popoverRef.current) return;

    const firstFocusable = popoverRef.current.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );

    (firstFocusable ?? popoverRef.current).focus();
  }, [popover?.annotationId]);

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
        left: popover.anchorX,
        top: popover.anchorY,
        zIndex: 50,
      }}
      className="w-72 rounded-lg border bg-popover shadow-lg"
    >
      <CommentCard annotation={annotation} chatId={chatId} />
    </div>
  );
};
