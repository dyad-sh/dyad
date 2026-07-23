import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "jotai";
import {
  createMachineProvider,
  useRegisterEntityDisposer,
} from "@/state_machines/react";
import { ChatStreamManager, type StreamFinishedEvent } from "./manager";

function useOwnedChatStreamManager(): ChatStreamManager {
  const store = useStore();
  const [manager] = useState(() => new ChatStreamManager(store));
  return manager;
}

function useChatStreamMount(manager: ChatStreamManager): void {
  useRegisterEntityDisposer("chat", manager.disposeKey);
}

const chatStreamProvider = createMachineProvider({
  name: "ChatStream",
  useOwnedManager: useOwnedChatStreamManager,
  useOnMount: useChatStreamMount,
});

export const ChatStreamProvider = chatStreamProvider.Provider;
export const useChatStreamManager = chatStreamProvider.useManager;

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
