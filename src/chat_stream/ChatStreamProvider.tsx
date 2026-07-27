import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "jotai";
import {
  createMachineProvider,
  useRegisterEntityDisposer,
} from "@/state_machines/react";
import {
  ChatStreamRemoteManager,
  type StreamFinishedEvent,
} from "./remote_manager";
function useOwnedChatStreamManager(): ChatStreamRemoteManager {
  const store = useStore();
  const [manager] = useState(() => new ChatStreamRemoteManager(store));
  return manager;
}

function useChatStreamMount(manager: ChatStreamRemoteManager): void {
  useRegisterEntityDisposer("chat", manager.disposeKey);
}

const chatStreamProvider = createMachineProvider<ChatStreamRemoteManager>({
  name: "ChatStream",
  useOwnedManager: useOwnedChatStreamManager,
  useOnMount: useChatStreamMount,
});

export const ChatStreamProvider = chatStreamProvider.Provider;
export function useChatStreamManager(): ChatStreamRemoteManager {
  return chatStreamProvider.useManager();
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
