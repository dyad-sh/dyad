/**
 * Writing conversations into the memory vault.
 *
 * Saving is append-only and idempotent: each save writes just the turns the
 * file does not already hold. A crash between turns therefore costs nothing,
 * and a retry cannot duplicate the transcript.
 *
 * Failures are swallowed by design. Losing a saved turn is regrettable; taking
 * down the conversation the user is having is not acceptable, so every entry
 * point here reports rather than throws.
 */

import fs from "node:fs";
import path from "node:path";
import log from "electron-log";

import { readSettings } from "../../main/settings";
import { memoryPath } from "./memory_vault";
import {
  conversationFileName,
  conversationHeader,
  renderTurn,
  turnsToAppend,
  type ConversationTurn,
} from "./memory_documents";
import { indexMemoryVault } from "./memory_index";
import { enqueueJob } from "./memory_jobs";
import { runWorker } from "./memory_worker";

/**
 * Runs the extraction worker without letting two runs overlap.
 *
 * One job at a time by default: extraction writes to shared files, and a
 * second concurrent pass would race them.
 */
let workerRunning = false;
let shuttingDown = false;

export function stopMemoryWorker(): void {
  shuttingDown = true;
}

async function scheduleWorker(vaultPath: string): Promise<void> {
  if (workerRunning || shuttingDown) return;
  workerRunning = true;
  try {
    await runWorker(vaultPath, {
      signal: {
        get aborted() {
          return shuttingDown;
        },
      },
    });
  } catch (error) {
    logger.warn("Memory worker pass failed", error);
  } finally {
    workerRunning = false;
  }
}

const logger = log.scope("conversation_store");

/**
 * Which file each session is being written to.
 *
 * The vault it belongs to is remembered too: if the user points the app at a
 * different vault mid-session, the old path is abandoned rather than written
 * to a location that is no longer theirs.
 */
const sessionFiles = new Map<string, { vaultPath: string; filePath: string }>();

function titleFor(turns: ConversationTurn[]): string {
  const firstUser = turns.find((turn) => turn.role === "user");
  if (!firstUser) return "Conversation";
  return (
    firstUser.content.trim().split(/\r?\n/)[0]!.slice(0, 60) || "Conversation"
  );
}

/**
 * Appends whatever is new in this conversation to its Markdown file.
 *
 * Returns the file's vault-relative path, or null when nothing was saved —
 * because there is no vault, or because saving failed.
 */
export async function saveConversation(
  sessionId: string,
  turns: ConversationTurn[],
): Promise<string | null> {
  if (turns.length === 0) return null;
  const vaultPath = readSettings().storage?.localVaultPath?.trim();
  if (!vaultPath) return null;

  try {
    const directory = memoryPath(vaultPath, "Conversations");
    await fs.promises.mkdir(directory, { recursive: true });

    const remembered = sessionFiles.get(sessionId);
    let filePath =
      remembered && remembered.vaultPath === vaultPath
        ? remembered.filePath
        : undefined;
    if (!filePath) {
      filePath = path.join(
        directory,
        conversationFileName(new Date(), titleFor(turns)),
      );
      sessionFiles.set(sessionId, { vaultPath, filePath });
    }

    const now = new Date().toISOString();
    let existing = "";
    if (fs.existsSync(filePath)) {
      existing = await fs.promises.readFile(filePath, "utf8");
    } else {
      const header = conversationHeader({
        id: sessionId,
        title: titleFor(turns),
        created: now,
        updated: now,
        project: null,
      });
      await fs.promises.writeFile(filePath, header, "utf8");
      existing = header;
    }

    const pending = turnsToAppend(existing, turns);
    if (pending.length === 0) return relative(vaultPath, filePath);

    await fs.promises.appendFile(
      filePath,
      pending.map(renderTurn).join(""),
      "utf8",
    );

    // Re-index in the background. The saved Markdown is already durable, so a
    // failure here costs only searchability until the next save.
    void indexMemoryVault(vaultPath).catch((error) => {
      logger.warn("Could not re-index memory after saving", error);
    });

    // Queue extraction durably. The job outlives this process, so a crash
    // between saving and extracting costs nothing but a delay.
    void enqueueJob(vaultPath, {
      conversationId: sessionId,
      conversationPath: relative(vaultPath, filePath),
      content: existing + pending.map(renderTurn).join(""),
    }).then(
      (queued) => {
        // Drain shortly after, off the reply's critical path. Failure here is
        // logged, never surfaced into the conversation.
        if (queued) void scheduleWorker(vaultPath);
      },
      (error) => logger.warn("Could not queue memory extraction", error),
    );

    return relative(vaultPath, filePath);
  } catch (error) {
    logger.warn(`Could not save conversation ${sessionId}`, error);
    return null;
  }
}

function relative(vaultPath: string, filePath: string): string {
  return path.relative(vaultPath, filePath).replace(/\\/g, "/");
}

/** Forgets a session's file, so a new conversation starts a new file. */
export function forgetConversationFile(sessionId: string): void {
  sessionFiles.delete(sessionId);
}
