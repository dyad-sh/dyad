import log from "electron-log";
import { db } from "@/db";
import {
  CHAT_SEARCH_PROJECTION_VERSION,
  projectChatMessageForSearch,
} from "./tools/chat_search_text";

/**
 * Background maintenance for the chat_search_fts index.
 *
 * SQLite triggers (drizzle/0039_chat-search-fts.sql) enqueue changed source
 * rows into chat_search_dirty_messages / chat_search_dirty_chats; this module
 * drains those queues, builds the TypeScript text projection for each
 * message, and replaces the corresponding FTS row.
 *
 * Everything runs on the main process against the single shared better-sqlite3
 * connection. Each batch is one synchronous transaction, so a batch can never
 * interleave with other database work; between batches the drain loop yields
 * to the event loop so indexing a large backlog does not block Electron.
 *
 * The search_chats tool never writes: it may await an in-flight drain via
 * waitForChatSearchIndexingIdle and report per-app dirty counts, but only the
 * startup hook, the post-stream settle hooks, and the repair poll initiate
 * indexing.
 */
const logger = log.scope("chat_search_indexer");

const BATCH_SIZE = 50;
/** Debounce for settle-triggered kicks so bursts coalesce into one drain. */
const KICK_DELAY_MS = 500;
/** Low-frequency repair poll for mutation paths without an explicit kick. */
const REPAIR_POLL_INTERVAL_MS = 60_000;
const PROJECTION_VERSION_KEY = "projection_version";

let started = false;
let kickTimer: NodeJS.Timeout | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let draining: Promise<void> | null = null;
let drainAgain = false;

export function startChatSearchIndexer(): void {
  if (started) return;
  started = true;
  try {
    ensureProjectionVersion();
    cleanupOrphanedFtsRows();
  } catch (error) {
    logger.error("Failed to prepare chat search index:", error);
  }
  scheduleChatSearchIndexing(0);
  schedulePoll();
}

export function stopChatSearchIndexer(): void {
  started = false;
  if (kickTimer) {
    clearTimeout(kickTimer);
    kickTimer = null;
  }
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

/**
 * Request a drain soon. Called after a chat stream settles (final message
 * write) and at startup. Debounced; safe to call from any handler.
 */
export function scheduleChatSearchIndexing(delayMs = KICK_DELAY_MS): void {
  if (!started) return;
  if (kickTimer) clearTimeout(kickTimer);
  kickTimer = setTimeout(() => {
    kickTimer = null;
    void kickDrain();
  }, delayMs);
}

/**
 * Await the in-flight drain (if any) up to timeoutMs. Read-only callers use
 * this to briefly wait for freshness without initiating index writes.
 */
export async function waitForChatSearchIndexingIdle(
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (draining && Date.now() < deadline) {
    const timeLeft = deadline - Date.now();
    await Promise.race([
      draining,
      new Promise((resolve) => setTimeout(resolve, timeLeft)),
    ]);
  }
}

/**
 * Number of source rows for this app still waiting to be (re)indexed.
 * Dirty rows for already-deleted messages don't join and are excluded — the
 * delete triggers already removed their FTS rows. `excludeChatId` skips the
 * caller's own chat: during a turn the current chat's user message and
 * streaming placeholder are always dirty (settle hasn't run yet), and since
 * search excludes the current chat anyway, counting them would make
 * search_chats report "indexing" on effectively every call.
 */
export function getChatSearchPendingCountForApp(
  appId: number,
  excludeChatId: number,
): number {
  const row = db.$client
    .prepare(
      `SELECT
         (SELECT COUNT(*)
            FROM chat_search_dirty_messages dm
            JOIN messages m ON m.id = dm.message_id
            JOIN chats c ON c.id = m.chat_id
           WHERE c.app_id = ? AND c.id != ?)
         +
         (SELECT COUNT(*)
            FROM chat_search_dirty_chats dc
            JOIN chats c2 ON c2.id = dc.chat_id
           WHERE c2.app_id = ? AND c2.id != ?) AS pending`,
    )
    .get(appId, excludeChatId, appId, excludeChatId) as { pending: number };
  return row.pending;
}

/**
 * Drain everything right now. Exposed for tests (and reused by the
 * background loop) so specs can index deterministically without timers.
 */
export async function drainChatSearchIndexOnce(): Promise<void> {
  drainDirtyChats();
  let processed: number;
  do {
    processed = drainDirtyMessageBatch();
    if (processed > 0) {
      // Yield between batches so a large backlog cannot monopolize the
      // main process event loop.
      await new Promise((resolve) => setImmediate(resolve));
    }
  } while (processed > 0);
}

/** Test-only: reset module state between specs. */
export function resetChatSearchIndexerForTesting(): void {
  stopChatSearchIndexer();
  draining = null;
  drainAgain = false;
}

async function kickDrain(): Promise<void> {
  if (draining) {
    drainAgain = true;
    return;
  }
  draining = (async () => {
    try {
      do {
        drainAgain = false;
        await drainChatSearchIndexOnce();
      } while (drainAgain && started);
    } catch (error) {
      logger.error("Chat search index drain failed:", error);
    } finally {
      draining = null;
    }
  })();
  await draining;
}

function schedulePoll(): void {
  if (!started) return;
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void kickDrain().finally(() => schedulePoll());
  }, REPAIR_POLL_INTERVAL_MS);
}

/**
 * A chat-title change re-projects every message in that chat: expand each
 * dirty chat into dirty message rows, then let the message drain handle them.
 */
function drainDirtyChats(): void {
  const client = db.$client;
  const expand = client.transaction((chatId: number) => {
    client
      .prepare(
        `INSERT OR REPLACE INTO chat_search_dirty_messages (message_id)
         SELECT id FROM messages WHERE chat_id = ?`,
      )
      .run(chatId);
    client
      .prepare(`DELETE FROM chat_search_dirty_chats WHERE chat_id = ?`)
      .run(chatId);
  });
  for (;;) {
    const rows = client
      .prepare(`SELECT chat_id FROM chat_search_dirty_chats LIMIT ?`)
      .all(BATCH_SIZE) as { chat_id: number }[];
    if (rows.length === 0) return;
    for (const row of rows) {
      expand(row.chat_id);
    }
  }
}

interface DirtyMessageSourceRow {
  id: number;
  role: "user" | "assistant";
  content: string;
  is_compaction_summary: number | null;
  created_at: number;
  chat_id: number;
  app_id: number;
  title: string | null;
}

/** Returns the number of dirty rows processed (0 = queue empty). */
function drainDirtyMessageBatch(): number {
  const client = db.$client;
  const runBatch = client.transaction((): number => {
    const dirty = client
      .prepare(`SELECT message_id FROM chat_search_dirty_messages LIMIT ?`)
      .all(BATCH_SIZE) as { message_id: number }[];
    if (dirty.length === 0) return 0;

    const sourceStmt = client.prepare(
      `SELECT m.id, m.role, m.content, m.is_compaction_summary, m.created_at,
              m.chat_id, c.app_id, c.title
         FROM messages m
         JOIN chats c ON c.id = m.chat_id
        WHERE m.id = ?`,
    );
    const deleteFtsStmt = client.prepare(
      `DELETE FROM chat_search_fts WHERE rowid = ?`,
    );
    const insertFtsStmt = client.prepare(
      `INSERT INTO chat_search_fts
         (rowid, title, body, app_id, chat_id, role, message_created_at,
          is_compaction_summary, projection_truncated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const clearDirtyStmt = client.prepare(
      `DELETE FROM chat_search_dirty_messages WHERE message_id = ?`,
    );

    for (const { message_id } of dirty) {
      const source = sourceStmt.get(message_id) as
        | DirtyMessageSourceRow
        | undefined;
      deleteFtsStmt.run(message_id);
      if (source) {
        const projection = projectChatMessageForSearch({
          role: source.role,
          content: source.content,
          isCompactionSummary: Boolean(source.is_compaction_summary),
        });
        if (projection.text) {
          insertFtsStmt.run(
            message_id,
            source.title ?? "",
            projection.text,
            source.app_id,
            source.chat_id,
            source.role,
            source.created_at,
            source.is_compaction_summary ? 1 : 0,
            projection.truncated ? 1 : 0,
          );
        }
      }
      clearDirtyStmt.run(message_id);
    }
    return dirty.length;
  });
  return runBatch();
}

/**
 * When the projection policy changes (CHAT_SEARCH_PROJECTION_VERSION bump),
 * mark every message dirty so documents rebuild in the background.
 */
function ensureProjectionVersion(): void {
  const client = db.$client;
  const stored = client
    .prepare(`SELECT value FROM chat_search_meta WHERE key = ?`)
    .get(PROJECTION_VERSION_KEY) as { value: string } | undefined;
  if (stored?.value === String(CHAT_SEARCH_PROJECTION_VERSION)) {
    return;
  }
  client.transaction(() => {
    client
      .prepare(
        `INSERT OR REPLACE INTO chat_search_dirty_messages (message_id)
         SELECT id FROM messages`,
      )
      .run();
    client
      .prepare(
        `INSERT OR REPLACE INTO chat_search_meta (key, value) VALUES (?, ?)`,
      )
      .run(PROJECTION_VERSION_KEY, String(CHAT_SEARCH_PROJECTION_VERSION));
  })();
  if (stored) {
    logger.log(
      `Chat search projection version changed to ${CHAT_SEARCH_PROJECTION_VERSION}; scheduled full rebuild`,
    );
  }
}

/**
 * Startup repair: delete FTS rows whose source message no longer exists.
 * Triggers normally keep the index consistent (including through cascade
 * deletes); this covers anything that slipped past them.
 */
function cleanupOrphanedFtsRows(): void {
  db.$client
    .prepare(
      `DELETE FROM chat_search_fts
        WHERE rowid NOT IN (SELECT id FROM messages)`,
    )
    .run();
}
