import { useEffect, useRef } from "react";
import { useAtomValue, useStore } from "jotai";
import {
  queuedMessagesByIdAtom,
  queuePausedByIdAtom,
  type QueuedMessageItem,
} from "@/atoms/chatAtoms";
import { ipc } from "@/ipc/types";
import type { PersistedQueue, PersistedQueuedMessage } from "@/ipc/types/queue";
import { chatAttachmentToFileAttachment } from "@/lib/attachment_conversion";
import { convertFileAttachmentsToChatAttachments } from "@/lib/chatAttachmentConversion";
import { showInfo } from "@/lib/toast";

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
  const store = useStore();

  // Only start persisting after the initial hydration completes successfully,
  // so we never clobber the on-disk queue with the empty initial atom state.
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
  // Queue mutations that happen while hydration is still in flight aren't
  // persisted by the effect below (it's disarmed); remember them so the
  // hydration path can flush the merged state once it completes.
  const mutatedDuringHydrationRef = useRef(false);
  // The exact Map instance produced by the hydration merge. The persist effect
  // skips it: the data just came from disk, so writing it straight back would
  // be a redundant IPC round-trip and file write on every startup.
  const hydrationResultRef = useRef<Map<number, QueuedMessageItem[]> | null>(
    null,
  );
  // Encoded snapshots keyed by item identity. Queue mutators replace items
  // rather than mutating them, so an entry can never go stale, and the WeakMap
  // lets dropped items be GC'd without explicit pruning. Pre-encoding keeps
  // the on-close flush free of FileReader work, which can't complete during
  // page teardown.
  const encodedItemCacheRef = useRef(
    new WeakMap<QueuedMessageItem, PersistedQueuedMessage>(),
  );

  const enqueuePersist = (queue: Map<number, QueuedMessageItem[]>) => {
    lastWritePromiseRef.current = lastWritePromiseRef.current
      .catch(() => {})
      .then(() => persistQueue(queue, encodedItemCacheRef.current));
  };

  // Hydrate once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let persisted: PersistedQueue;
      try {
        persisted = await ipc.queue.getQueuedPrompts();
      } catch (error) {
        // Leave persistence disarmed: the on-disk queue may still hold data
        // the in-memory state doesn't know about, and arming the persist
        // effect now would let the next queue mutation overwrite and delete
        // those files. Hydration is retried on the next launch.
        console.error("[QUEUE] Failed to hydrate queued prompts:", error);
        return;
      }
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
            attachments: item.attachments?.map(chatAttachmentToFileAttachment),
            selectedComponents: item.selectedComponents,
          })),
        );
      }

      if (map.size > 0) {
        // Merge rather than replace: if a prompt was enqueued between mount
        // and when this async hydration resolves, replacing would silently
        // discard it. Reading and writing through the store keeps the whole
        // merge synchronous instead of relying on updater-callback timing.
        const current = store.get(queuedMessagesByIdAtom);
        const merged = new Map(current);
        const restoredChatIds = new Set<number>();
        let restoredCount = 0;
        for (const [chatId, items] of map) {
          const existing = merged.get(chatId);
          if (!existing) {
            merged.set(chatId, items);
            restoredChatIds.add(chatId);
            restoredCount += items.length;
            continue;
          }
          // The user queued prompts for this chat while hydration was in
          // flight: keep both, persisted (older) items first, deduplicated
          // by id so a double hydration can't duplicate entries.
          const existingIds = new Set(existing.map((item) => item.id));
          const restoredItems = items.filter(
            (item) => !existingIds.has(item.id),
          );
          if (restoredItems.length > 0) {
            merged.set(chatId, [...restoredItems, ...existing]);
            restoredChatIds.add(chatId);
            restoredCount += restoredItems.length;
          }
        }

        if (restoredChatIds.size > 0) {
          hydrationResultRef.current = merged;
          store.set(queuedMessagesByIdAtom, merged);
          // Restore in a paused state: a restart may happen hours after the
          // prompts were queued (or after a crash mid-sequence), so silently
          // auto-executing them would be a hidden side effect. The user
          // reviews the restored queue and resumes it from the chat input.
          const paused = new Map(store.get(queuePausedByIdAtom));
          for (const chatId of restoredChatIds) {
            paused.set(chatId, true);
          }
          store.set(queuePausedByIdAtom, paused);
          showInfo(
            `Restored ${restoredCount} queued prompt${
              restoredCount === 1 ? "" : "s"
            }${
              restoredChatIds.size > 1
                ? ` across ${restoredChatIds.size} chats`
                : ""
            }. Restored queues are paused — review and resume from the chat input.`,
          );
        }
      }

      hydratedRef.current = true;
      // Flush prompts queued while hydration was in flight: the persist
      // effect already ran for those changes while disarmed and won't re-run.
      if (mutatedDuringHydrationRef.current) {
        enqueuePersist(store.get(queuedMessagesByIdAtom));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist (debounced) whenever the queue changes, after hydration.
  useEffect(() => {
    // Pre-encode attachments as soon as items are queued (independent of the
    // write debounce) so the on-close flush can persist from cache alone.
    void warmEncodedItemCache(queuedMessagesById, encodedItemCacheRef.current);

    if (!hydratedRef.current) {
      if (queuedMessagesById.size > 0) {
        mutatedDuringHydrationRef.current = true;
      }
      return;
    }
    if (queuedMessagesById === hydrationResultRef.current) {
      // This change is the hydration merge itself; its data just came from
      // disk (any additions made during hydration are flushed by the
      // hydration effect), so persisting it again would be redundant.
      return;
    }

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
  // change isn't lost. The write goes out as a one-way IPC (see
  // queueSendContracts.setQueuedPrompts): a reply-expecting `invoke` fired here
  // would leave the main process replying to the frame Electron is tearing
  // down, throwing "Object has been destroyed". Attachments are served from the
  // pre-encoded cache, so the flush avoids FileReader work that can't finish
  // during teardown; only items queued in the last instants before close (cache
  // warm still pending) remain best-effort, as do hard crashes/kills.
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

async function encodeQueuedItem(
  item: QueuedMessageItem,
  cache: WeakMap<QueuedMessageItem, PersistedQueuedMessage>,
): Promise<PersistedQueuedMessage> {
  const cached = cache.get(item);
  if (cached) return cached;
  const encoded: PersistedQueuedMessage = {
    id: item.id,
    prompt: item.prompt,
    attachments: item.attachments
      ? await convertFileAttachmentsToChatAttachments(item.attachments)
      : undefined,
    selectedComponents: item.selectedComponents,
  };
  cache.set(item, encoded);
  return encoded;
}

async function warmEncodedItemCache(
  queue: Map<number, QueuedMessageItem[]>,
  cache: WeakMap<QueuedMessageItem, PersistedQueuedMessage>,
): Promise<void> {
  try {
    await Promise.all(
      [...queue.values()].flat().map((item) => encodeQueuedItem(item, cache)),
    );
  } catch (error) {
    console.error("[QUEUE] Failed to pre-encode queued attachments:", error);
  }
}

async function persistQueue(
  queuedMessagesById: Map<number, QueuedMessageItem[]>,
  cache: WeakMap<QueuedMessageItem, PersistedQueuedMessage>,
): Promise<void> {
  try {
    const persisted: PersistedQueue = {};
    for (const [chatId, items] of queuedMessagesById) {
      if (items.length === 0) continue;
      persisted[String(chatId)] = await Promise.all(
        items.map((item) => encodeQueuedItem(item, cache)),
      );
    }
    // Fire-and-forget: main serializes the write and never replies, so this is
    // safe even when called from the on-close flush during frame teardown.
    ipc.queue.setQueuedPrompts(persisted);
  } catch (error) {
    console.error("[QUEUE] Failed to persist queued prompts:", error);
  }
}
