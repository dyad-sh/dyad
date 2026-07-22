import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "jotai";
import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { useChatStreamManager } from "@/chat_stream/ChatStreamProvider";
import type { StreamState } from "@/chat_stream/state";

import { useSettings } from "./useSettings";

const IDLE_UNSUBSCRIBE = () => {};

/**
 * React binding for the per-chat stream machine via `useSyncExternalStore`.
 * Returns the current machine snapshot for the chat (or undefined without a
 * chat id).
 */
export function useChatStreamState(
  chatId: number | undefined,
): StreamState | undefined {
  const manager = useChatStreamManager();
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (chatId === undefined) return IDLE_UNSUBSCRIBE;
      return manager.ensure(chatId).subscribe(onStoreChange);
    },
    [chatId, manager],
  );
  const getSnapshot = useCallback(
    () =>
      chatId === undefined ? undefined : manager.ensure(chatId).getSnapshot(),
    [chatId, manager],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Root-level runtime wiring for the chat stream machine. Mount exactly once
 * (app layout / test harness). Registers the environment (Jotai store, React
 * Query client, settings, PostHog) that the production command adapter needs
 * to execute stream side effects — including background queue dispatch for
 * chats whose page is not open.
 */
export function useChatStreamRuntime(): void {
  const manager = useChatStreamManager();
  const store = useStore();
  const queryClient = useQueryClient();
  const { settings } = useSettings();
  const posthog = usePostHog();

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const posthogRef = useRef(posthog);
  posthogRef.current = posthog;

  const register = useCallback(() => {
    manager.registerRuntimeDeps({
      store,
      queryClient,
      getSettings: () => settingsRef.current,
      getPosthog: () => posthogRef.current ?? null,
    });
  }, [manager, store, queryClient]);

  // Register synchronously on the first render too: child components mount
  // (and can submit) before the parent layout's effects run.
  const registeredOnceRef = useRef(false);
  if (!registeredOnceRef.current) {
    registeredOnceRef.current = true;
    register();
  }

  useEffect(() => {
    register();
  }, [register]);
}
