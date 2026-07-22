import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type PropsWithChildren,
} from "react";

import type { ChatStreamManager, StreamFinishedEvent } from "./manager";

const ChatStreamContext = createContext<ChatStreamManager | null>(null);

export function ChatStreamProvider({
  manager,
  children,
}: PropsWithChildren<{ manager: ChatStreamManager }>) {
  useManagerLifecycle(manager);

  return (
    <ChatStreamContext.Provider value={manager}>
      {children}
    </ChatStreamContext.Provider>
  );
}

function useManagerLifecycle(manager: ChatStreamManager) {
  const generation = useRef(0);

  useEffect(() => {
    const currentGeneration = ++generation.current;

    return () => {
      queueMicrotask(() => {
        if (generation.current === currentGeneration) {
          manager.dispose();
        }
      });
    };
  }, [manager]);
}

export function useChatStreamManager(): ChatStreamManager {
  const manager = useContext(ChatStreamContext);
  if (!manager) {
    throw new Error("useChatStreamManager requires ChatStreamProvider");
  }
  return manager;
}

/** Subscribe to one-shot terminal stream events without mirroring them into state. */
export function useStreamFinished(
  callback: (event: StreamFinishedEvent) => void,
): void {
  const manager = useChatStreamManager();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const notify = useCallback(
    (event: StreamFinishedEvent) => callbackRef.current(event),
    [],
  );

  useEffect(() => manager.subscribeStreamFinished(notify), [manager, notify]);
}
