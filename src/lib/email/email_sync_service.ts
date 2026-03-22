/**
 * Email Sync Service
 *
 * Manages background sync for all email accounts, persisting
 * messages to the local SQLite DB and emitting events for the UI.
 */

import { db } from "@/db";
import {
  emailAccounts,
  emailMessages,
  emailFolders,
  emailSyncLog,
} from "@/db/schema";
import { getProvider, removeProvider } from "./email_provider_factory";
import { eq, and, inArray } from "drizzle-orm";
import log from "electron-log";
import { BrowserWindow } from "electron";
import type {
  EmailAccountConfig,
  EmailProviderType,
  EmailSyncEvent,
  EmailSyncResult,
  EmailMessage,
  EmailFolder,
} from "@/types/email_types";

const logger = log.scope("email/sync");

/** Timer handles per account */
const syncTimers = new Map<string, ReturnType<typeof setInterval>>();

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Start periodic syncing for an account.
 * If already running, restarts with latest interval.
 */
export function startSync(accountId: string): void {
  stopSync(accountId);

  // Do one immediate sync, then schedule
  doSync(accountId).catch((err) =>
    logger.error(`Initial sync failed for ${accountId}: ${err}`),
  );

  const row = db
    .select()
    .from(emailAccounts)
    .where(eq(emailAccounts.id, accountId))
    .get();

  const config = (row?.config ?? {}) as EmailAccountConfig;
  const interval = config.syncIntervalMs ?? 60_000;

  const timer = setInterval(() => {
    doSync(accountId).catch((err) =>
      logger.error(`Sync failed for ${accountId}: ${err}`),
    );
  }, interval);

  syncTimers.set(accountId, timer);
  logger.info(`Started sync for ${accountId} every ${interval}ms`);
}

/** Stop periodic syncing for an account. */
export function stopSync(accountId: string): void {
  const timer = syncTimers.get(accountId);
  if (timer) {
    clearInterval(timer);
    syncTimers.delete(accountId);
    logger.info(`Stopped sync for ${accountId}`);
  }
}

/** Stop all syncs and disconnect all providers. */
export async function stopAllSyncs(): Promise<void> {
  for (const id of syncTimers.keys()) {
    stopSync(id);
    await removeProvider(id);
  }
}

/** Start syncing all accounts that are in the DB. */
export function startAllSyncs(): void {
  const accounts = db.select().from(emailAccounts).all();
  for (const acct of accounts) {
    startSync(acct.id);
  }
}

/** Force an immediate sync for one account. */
export async function syncNow(accountId: string): Promise<EmailSyncResult> {
  return doSync(accountId);
}

// ─── Core Sync Logic ─────────────────────────────────────────────────────────

async function doSync(accountId: string): Promise<EmailSyncResult> {
  const startTime = Date.now();
  emitSyncEvent({
    accountId,
    type: "sync_started",
    timestamp: Date.now(),
  });

  const acctRow = db
    .select()
    .from(emailAccounts)
    .where(eq(emailAccounts.id, accountId))
    .get();

  if (!acctRow) {
    throw new Error(`Unknown email account ${accountId}`);
  }

  const config = acctRow.config as EmailAccountConfig;
  const provider = getProvider(
    accountId,
    acctRow.provider as EmailProviderType,
    config,
  );

  try {
    // Connect if needed
    if (!provider.isConnected()) {
      await provider.connect();
    }

    // Sync folders first
    const remoteFolders = await provider.listFolders();
    await upsertFolders(accountId, remoteFolders);

    // Incremental message sync
    const cursor = acctRow.syncCursor ?? undefined;
    const syncType = cursor ? "incremental" : "full";
    const { messages, deletedIds, newCursor } =
      await provider.syncChanges(cursor);

    let added = 0;
    let deleted = 0;
    let updated = 0;

    // Persist new / changed messages
    for (const msg of messages) {
      const existing = db
        .select({ id: emailMessages.id })
        .from(emailMessages)
        .where(
          and(
            eq(emailMessages.accountId, accountId),
            eq(emailMessages.remoteId, msg.remoteId),
          ),
        )
        .get();

      if (existing) {
        // Update mutable fields
        db.update(emailMessages)
          .set({
            isRead: msg.isRead,
            isStarred: msg.isStarred,
            folder: msg.folder,
          })
          .where(eq(emailMessages.id, existing.id))
          .run();
        updated++;
      } else {
        db.insert(emailMessages)
          .values({
            accountId,
            remoteId: msg.remoteId,
            threadId: msg.threadId,
            folder: msg.folder,
            from: msg.from,
            to: msg.to,
            cc: msg.cc,
            bcc: msg.bcc,
            subject: msg.subject,
            bodyPlain: msg.bodyPlain,
            bodyHtml: msg.bodyHtml,
            snippet: msg.snippet,
            date: new Date(msg.date),
            isRead: msg.isRead,
            isStarred: msg.isStarred,
            hasAttachments: msg.hasAttachments,
            size: msg.size ?? 0,
          })
          .run();
        added++;
      }
    }

    // Remove deleted
    if (deletedIds.length > 0) {
      db.delete(emailMessages)
        .where(
          and(
            eq(emailMessages.accountId, accountId),
            inArray(emailMessages.remoteId, deletedIds),
          ),
        )
        .run();
      deleted = deletedIds.length;
    }

    // Update sync cursor
    db.update(emailAccounts)
      .set({
        syncCursor: newCursor,
        lastSyncAt: new Date(),
      })
      .where(eq(emailAccounts.id, accountId))
      .run();

    // Log
    const result: EmailSyncResult = {
      accountId,
      syncType,
      status: "success",
      messagesAdded: added,
      messagesDeleted: deleted,
      messagesUpdated: updated,
      durationMs: Date.now() - startTime,
    };

    db.insert(emailSyncLog)
      .values({
        accountId,
        syncType,
        status: "success",
        messagesAdded: added,
        messagesDeleted: deleted,
        messagesUpdated: updated,
        completedAt: new Date(),
      })
      .run();

    emitSyncEvent({
      accountId,
      type: "sync_completed",
      data: { messagesAdded: added, messagesDeleted: deleted },
      timestamp: Date.now(),
    });

    logger.info(
      `Sync complete for ${accountId}: +${added} -${deleted} ~${updated} (${result.durationMs}ms)`,
    );
    return result;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`Sync error for ${accountId}: ${errorMsg}`);

    db.insert(emailSyncLog)
      .values({
        accountId,
        syncType: "incremental",
        status: "error",
        error: errorMsg,
        completedAt: new Date(),
      })
      .run();

    emitSyncEvent({
      accountId,
      type: "sync_error",
      data: { error: errorMsg },
      timestamp: Date.now(),
    });

    return {
      accountId,
      syncType: "incremental",
      status: "error",
      messagesAdded: 0,
      messagesDeleted: 0,
      messagesUpdated: 0,
      error: errorMsg,
      durationMs: Date.now() - startTime,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function upsertFolders(
  accountId: string,
  remoteFolders: EmailFolder[],
): Promise<void> {
  for (const rf of remoteFolders) {
    const existing = db
      .select({ id: emailFolders.id })
      .from(emailFolders)
      .where(
        and(
          eq(emailFolders.accountId, accountId),
          eq(emailFolders.path, rf.path),
        ),
      )
      .get();

    if (existing) {
      db.update(emailFolders)
        .set({
          name: rf.name,
          type: rf.type,
          unreadCount: rf.unreadCount,
          totalCount: rf.totalCount,
          lastSyncAt: new Date(),
        })
        .where(eq(emailFolders.id, existing.id))
        .run();
    } else {
      db.insert(emailFolders)
        .values({
          accountId,
          name: rf.name,
          path: rf.path,
          type: rf.type,
          delimiter: rf.delimiter,
          unreadCount: rf.unreadCount,
          totalCount: rf.totalCount,
          lastSyncAt: new Date(),
        })
        .run();
    }
  }
}

function emitSyncEvent(event: EmailSyncEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("email:sync-event", event);
  }
}
