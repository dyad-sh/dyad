import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type TouchEventHandler,
  type UIEventHandler,
  type WheelEventHandler,
} from "react";
import { animateScrollTo, type ScrollAnimation } from "@/lib/smooth_scroll";

/**
 * How close to the bottom still counts as "reading the latest".
 *
 * Generous on purpose: someone who has drifted a line or two should still be
 * carried along, while someone who scrolled up to re-read is left alone.
 */
export const CHAT_BOTTOM_THRESHOLD_PX = 200;

export function isChatNearBottom(
  element: HTMLElement,
  threshold = CHAT_BOTTOM_THRESHOLD_PX,
) {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <= threshold
  );
}

/**
 * Follows new chat output only while the user is already near the bottom.
 * Scrolling up suspends following immediately, including during streaming and
 * thinking states; scrolling back down resumes it.
 *
 * `isFollowing` is state rather than a ref so the view can offer a way back
 * when the conversation has moved on without the reader.
 */
export function useChatAutoScroll({
  conversationId,
  contentVersion,
  isStreaming,
}: {
  conversationId: string;
  contentVersion: unknown;
  isStreaming: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldFollowRef = useRef(true);
  const [isFollowing, setIsFollowing] = useState(true);
  /** How much has arrived below the reader since they scrolled away. */
  const [pendingCount, setPendingCount] = useState(0);
  /**
   * True while a scroll we started is in flight. A smooth glide back to the
   * bottom passes through positions that look exactly like "the user scrolled
   * up"; without this flag the glide would cancel the very follow it was
   * meant to resume.
   */
  const programmaticScrollRef = useRef(false);
  const programmaticTimeoutRef = useRef<number | null>(null);
  const resizeFrameRef = useRef<number | null>(null);

  /** The glide currently running, so a new target replaces it cleanly. */
  const scrollAnimationRef = useRef<ScrollAnimation | null>(null);

  const clearProgrammaticScroll = useCallback(() => {
    programmaticScrollRef.current = false;
    if (programmaticTimeoutRef.current !== null) {
      window.clearTimeout(programmaticTimeoutRef.current);
      programmaticTimeoutRef.current = null;
    }
  }, []);

  const beginProgrammaticScroll = useCallback((durationMs: number) => {
    programmaticScrollRef.current = true;
    if (programmaticTimeoutRef.current !== null) {
      window.clearTimeout(programmaticTimeoutRef.current);
    }
    programmaticTimeoutRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false;
      programmaticTimeoutRef.current = null;
    }, durationMs);
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const element = scrollRef.current;
      if (!element) return;
      scrollAnimationRef.current?.cancel();
      const target = element.scrollHeight;
      if (behavior === "auto") {
        // A streamed chunk may increase scrollHeight again before the scroll
        // event from this assignment arrives. Mark it as ours so that delayed
        // event cannot be mistaken for the reader scrolling upward.
        beginProgrammaticScroll(160);
        element.scrollTop = target;
        return;
      }
      beginProgrammaticScroll(800);
      // Driven frame by frame rather than with native smooth scrolling, which
      // restarts on every call and so never settles while text is arriving.
      scrollAnimationRef.current = animateScrollTo(element, target);
    },
    [beginProgrammaticScroll],
  );

  // A glide must not outlive the view it is moving.
  useEffect(() => () => scrollAnimationRef.current?.cancel(), []);

  /** Glides back to the newest message and resumes following. */
  const followLatest = useCallback(() => {
    shouldFollowRef.current = true;
    setIsFollowing(true);
    setPendingCount(0);
    // The guard belongs to the intent, not to the scroll. scrollToBottom sets
    // it too, but only after it has found the element and returned early if
    // there is none — which would leave the follow just resumed here exposed
    // to the glide's own scroll events and cancelled by them.
    beginProgrammaticScroll(800);
    scrollToBottom("smooth");
  }, [beginProgrammaticScroll, scrollToBottom]);

  useEffect(
    () => () => {
      if (programmaticTimeoutRef.current !== null) {
        window.clearTimeout(programmaticTimeoutRef.current);
      }
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
    },
    [],
  );

  const suspendFollowing = useCallback(() => {
    clearProgrammaticScroll();
    scrollAnimationRef.current?.cancel();
    shouldFollowRef.current = false;
    setIsFollowing(false);
  }, [clearProgrammaticScroll]);

  // Explicit reader input always wins over an in-flight automatic scroll.
  const handleWheel = useCallback<WheelEventHandler<HTMLDivElement>>(
    (event) => {
      clearProgrammaticScroll();
      if (event.deltaY < 0) suspendFollowing();
    },
    [clearProgrammaticScroll, suspendFollowing],
  );
  const handleTouchStart = useCallback<TouchEventHandler<HTMLDivElement>>(
    () => suspendFollowing(),
    [suspendFollowing],
  );
  const handlePointerDown = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      // A pointer near the scrollbar is a scrollbar drag, not text selection.
      if (event.clientX >= bounds.right - 20) suspendFollowing();
    },
    [suspendFollowing],
  );
  const handleKeyDown = useCallback<KeyboardEventHandler<HTMLDivElement>>(
    (event) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
        suspendFollowing();
      } else if (["ArrowDown", "PageDown", "End"].includes(event.key)) {
        clearProgrammaticScroll();
      }
    },
    [clearProgrammaticScroll, suspendFollowing],
  );

  const handleScroll = useCallback<UIEventHandler<HTMLDivElement>>(
    (event) => {
      const nearBottom = isChatNearBottom(event.currentTarget);

      // Positions passed through by our own glide say nothing about the user.
      if (programmaticScrollRef.current) {
        if (nearBottom) clearProgrammaticScroll();
        return;
      }

      shouldFollowRef.current = nearBottom;
      // This fires on every scroll frame; only re-render when the answer changes.
      setIsFollowing((current) => {
        if (current === nearBottom) return current;
        // Scrolling back down under your own steam clears the backlog just as
        // clicking the button does.
        if (nearBottom) setPendingCount(0);
        return nearBottom;
      });
    },
    [clearProgrammaticScroll],
  );

  useEffect(() => {
    shouldFollowRef.current = true;
    setIsFollowing(true);
    const frameId = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(frameId);
  }, [conversationId, scrollToBottom]);

  const previousStreamingRef = useRef(isStreaming);
  useEffect(() => {
    const justStarted = isStreaming && !previousStreamingRef.current;
    previousStreamingRef.current = isStreaming;
    if (!justStarted) return;
    // Sending/regenerating begins a new live turn. Bring that turn into view;
    // the reader can still scroll upward immediately afterward to pause follow.
    shouldFollowRef.current = true;
    setIsFollowing(true);
    setPendingCount(0);
    const frameId = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(frameId);
  }, [isStreaming, scrollToBottom]);

  // Markdown reflow, syntax highlighting, images and tool cards can grow after
  // the messages array changed. Follow the rendered content height as well as
  // token flushes so the latest line remains visible throughout generation.
  useEffect(() => {
    if (!isStreaming || typeof ResizeObserver === "undefined") return;
    const element = scrollRef.current;
    const content = element?.firstElementChild;
    if (!element || !content) return;
    const observer = new ResizeObserver(() => {
      if (!shouldFollowRef.current) return;
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        if (shouldFollowRef.current) scrollToBottom();
      });
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
    };
  }, [conversationId, isStreaming, scrollToBottom]);

  useEffect(() => {
    if (!shouldFollowRef.current) {
      // Content landed below the reader; remember there is more to come back to.
      setPendingCount((count) => Math.min(count + 1, 99));
      return;
    }
    const frameId = requestAnimationFrame(() => {
      if (shouldFollowRef.current) scrollToBottom();
    });
    return () => cancelAnimationFrame(frameId);
  }, [contentVersion, isStreaming, scrollToBottom]);

  useEffect(() => {
    setPendingCount(0);
  }, [conversationId]);

  return {
    scrollRef,
    handleScroll,
    scrollToBottom,
    followLatest,
    isFollowing,
    pendingCount,
    scrollIntentHandlers: {
      onWheel: handleWheel,
      onTouchStart: handleTouchStart,
      onPointerDown: handlePointerDown,
      onKeyDown: handleKeyDown,
    },
  };
}
