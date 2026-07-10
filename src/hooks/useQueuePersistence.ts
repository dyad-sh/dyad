import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  queuedMessagesByIdAtom,
  streamCompletedSuccessfullyByIdAtom,
  type QueuedMessageItem,
} from "@/atoms/chatAtoms";
import { ipc } from "@/ipc/types";
import type { PersistedQueue } from "@/ipc/types/queue";
import {
  chatAttachmentToFileAttachment,
  fileAttachmentToChatAttachment,
} from "@/lib/attachment_conversion";

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
  const setStreamCompletedSuccessfullyById = useSetAtom(
    streamCompletedSuccessfullyByIdAtom,
  );

  // Only start persisting after the initial hydration completes, so we never
  // clobber the on-disk queue with the empty initial atom state.
  const hydratedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          setQueuedMessagesById(map);
          // Seed the completion flag so the queue processor auto-resumes
          // draining restored prompts (mirrors resumeQueue() when idle).
          setStreamCompletedSuccessfullyById((prev) => {
            const next = new Map(prev);
            for (const chatId of map.keys()) {
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
      void persistQueue(queuedMessagesById);
    }, PERSIST_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [queuedMessagesById]);
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
            ? await Promise.all(
                item.attachments.map(fileAttachmentToChatAttachment),
              )
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
