import { useCallback, useRef, useState } from "react";
import { createChatScrollController } from "./controller";

export function useChatScroll(chatId: number | undefined) {
  const [showScrollButton, setShowScrollButton] = useState(false);
  const controller = useRef<ReturnType<
    typeof createChatScrollController
  > | null>(null);
  const resizeObserver = useRef<ResizeObserver | null>(null);
  const content = useRef<HTMLElement | null>(null);
  // A changed chat key detaches the old ref/controller before attaching the new
  // one. Ref teardown also covers terminal/version panes and actual unmounts.
  const scrollerRef = useCallback(
    (element: HTMLElement | Window | null) => {
      controller.current?.dispose();
      controller.current = null;
      resizeObserver.current?.disconnect();
      resizeObserver.current = null;
      if (!(element instanceof HTMLElement)) return;
      const owner = createChatScrollController(
        element,
        (following) => setShowScrollButton(!following),
        {
          request: (callback) => requestAnimationFrame(callback),
          cancel: (id) => cancelAnimationFrame(id),
        },
      );
      controller.current = owner;
      const observer = new ResizeObserver(owner.reconcile);
      observer.observe(element);
      if (content.current) observer.observe(content.current);
      resizeObserver.current = observer;
    },
    [chatId],
  );
  // Nonvirtualized test lists use the same controller, with a measured content
  // wrapper. Production receives totalListHeightChanged from Virtuoso instead.
  const contentRef = useCallback((element: HTMLDivElement | null) => {
    if (content.current) resizeObserver.current?.unobserve(content.current);
    content.current = element;
    if (element) resizeObserver.current?.observe(element);
  }, []);
  const onContentHeightChange = useCallback(
    () => controller.current?.reconcile(),
    [],
  );
  const scrollToBottom = useCallback(() => {
    if (!controller.current) return false;
    controller.current.follow();
    return true;
  }, []);
  return {
    scrollerRef,
    contentRef,
    onContentHeightChange,
    scrollToBottom,
    showScrollButton,
  };
}
