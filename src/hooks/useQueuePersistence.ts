import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  queuedMessagesByIdAtom,
  queuePausedByIdAtom,
  type QueuedMessageItem,
} from "@/atoms/chatAtoms";
import { ipc } from "@/ipc/types";
import type { PersistedQueue } from "@/ipc/types/queue";
import { chatAttachmentToFileAttachment } from "@/lib/attachment_conversion";
import { convertFileAttachmentsToChatAttachments } from "@/lib/chatAttachmentConversion";

const PERSIST_DEBOUNCE_MS = 400;

/**
 * Root-level hook that persists the in-memory queued-prompt state to disk and
 * hydrates it back on startup, so queued prompts survive app restarts / crashes.
 *
 * The `queuedMessagesByIdAtom` remains the single source of truth: this hook
 * mirrors it to a JSON file whenever it changes, and loads the file once on
 * mount. Existing queue mutators and the queue processor are unaffected.
 */
export function useQueuePersistence() {
  const queuedMessagesById = useAtomValue(queuedMessagesByIdAtom);
  const setQueuedMessagesById = useSetAtom(queuedMessagesByIdAtom);
  const setQueuePausedById = useSetAtom(queuePausedByIdAtom);

  // Only start persisting after the initial hydration completes, so we never
  // clobber the on-disk queue with the empty initial atom state.
  const hydratedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Serializes persist writes: each write is chained onto the previous one so
  // concurrent debounced writes can't resolve out of order and let an older
  // queue snapshot overwrite a newer one on disk.
  const lastWritePromiseRef = useRef<Promise<void>>(Promise.resolve());
  // Latest queue snapshot, so the on-close flush can persist the newest state
  // even while a debounce is still pending.
  const latestQueueRef = useRef(queuedMessagesById);
  latestQueueRef.current = queuedMessagesById;

  const enqueuePersist = (queue: Map<number, QueuedMessageItem[]>) => {
    lastWritePromiseRef.current = lastWritePromiseRef.current
      .catch(() => {})
      .then(() => persistQueue(queue));
  };

  // Hydrate once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const persisted = await ipc.queue.getQueuedPrompts();
        if (cancelled) return;

        const map = new Map<number, QueuedMessageItem[]>();
        for (const [chatIdStr, items] of Object.entries(persisted)) {
          const chatId = Number(chatIdStr);
          if (!Number.isFinite(chatId) || items.length === 0) continue;
          map.set(
            chatId,
            items.map((item) => ({
              id: item.id,
              prompt: item.prompt,
              attachments: item.attachments?.map(
                chatAttachmentToFileAttachment,
              ),
              selectedComponents: item.selectedComponents,
            })),
          );
        }

        if (map.size > 0) {
          // Merge rather than replace: if a prompt was enqueued between mount
          // and when this async hydration resolves, replacing would silently
          // discard it. Existing in-memory entries win over persisted ones.
          const restoredChatIds = new Set<number>();
          setQueuedMessagesById((prev) => {
            const merged = new Map(prev);
            for (const [chatId, items] of map) {
              if (!merged.has(chatId)) {
                merged.set(chatId, items);
                restoredChatIds.add(chatId);
              }
            }
            return merged;
          });
          // Restore in a paused state: a restart may happen hours after the
          // prompts were queued (or after a crash mid-sequence), so silently
          // auto-executing them would be a hidden side effect. The user
          // reviews the restored queue and resumes it from the chat input.
          // Chats the user queued during hydration are left untouched.
          setQueuePausedById((prev) => {
            const next = new Map(prev);
            for (const chatId of restoredChatIds) {
              next.set(chatId, true);
            }
            return next;
          });
        }
      } catch (error) {
        console.error("[QUEUE] Failed to hydrate queued prompts:", error);
      } finally {
        if (!cancelled) {
          hydratedRef.current = true;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist (debounced) whenever the queue changes, after hydration.
  useEffect(() => {
    if (!hydratedRef.current) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      enqueuePersist(queuedMessagesById);
    }, PERSIST_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedMessagesById]);

  // Best-effort flush on graceful window close: if the app is closed within the
  // debounce window, persist the latest snapshot immediately so the final queue
  // change isn't lost. Cannot help hard crashes/kills (the async attachment
  // encoding may not finish during teardown), but covers the common quit path.
  useEffect(() => {
    const flush = () => {
      if (!hydratedRef.current) return;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      enqueuePersist(latestQueueRef.current);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

async function persistQueue(
  queuedMessagesById: Map<number, QueuedMessageItem[]>,
): Promise<void> {
  try {
    const persisted: PersistedQueue = {};
    for (const [chatId, items] of queuedMessagesById) {
      if (items.length === 0) continue;
      persisted[String(chatId)] = await Promise.all(
        items.map(async (item) => ({
          id: item.id,
          prompt: item.prompt,
          attachments: item.attachments
            ? await convertFileAttachmentsToChatAttachments(item.attachments)
            : undefined,
          selectedComponents: item.selectedComponents,
        })),
      );
    }
    await ipc.queue.setQueuedPrompts(persisted);
  } catch (error) {
    console.error("[QUEUE] Failed to persist queued prompts:", error);
  }
}
