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
import type { ChatStreamManager } from "./manager";

export type AcceptedChatStreamManager =
  | ChatStreamRemoteManager
  | ChatStreamManager;

function useOwnedChatStreamManager(): AcceptedChatStreamManager {
  const store = useStore();
  const [manager] = useState(() => new ChatStreamRemoteManager(store));
  return manager;
}

function useChatStreamMount(manager: AcceptedChatStreamManager): void {
  useRegisterEntityDisposer("chat", manager.disposeKey);
}

const chatStreamProvider = createMachineProvider<AcceptedChatStreamManager>({
  name: "ChatStream",
  useOwnedManager: useOwnedChatStreamManager,
  useOnMount: useChatStreamMount,
});

export const ChatStreamProvider = chatStreamProvider.Provider;
export function useChatStreamManager(): AcceptedChatStreamManager {
  // Production always constructs the main-process adapter. Accepting the
  // legacy manager at the provider boundary is limited to cutover test
  // harnesses, which exercise the unchanged compatibility event surface.
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
