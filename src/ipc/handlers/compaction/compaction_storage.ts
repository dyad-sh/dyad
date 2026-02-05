/**
 * Compaction Storage Module
 * Stores human/LLM-readable conversation transcripts before compaction.
 */

import fs from "node:fs";
import path from "node:path";
import { getUserDataPath } from "@/paths/paths";
import log from "electron-log";

const logger = log.scope("compaction_storage");

/**
 * Message structure passed to the storage module.
 */
export interface CompactionMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Get the base directory for compaction backups.
 */
export function getCompactionBackupDir(): string {
  return path.join(getUserDataPath(), "compaction-backups");
}

/**
 * Get the backup directory for a specific chat.
 */
export function getChatBackupDir(chatId: number): string {
  return path.join(getCompactionBackupDir(), String(chatId));
}

/**
 * Format messages as a plain-text conversation transcript
 * that is easy for a future LLM to read.
 */
function formatAsTranscript(messages: CompactionMessage[]): string {
  return messages
    .map((m) => `[${m.role.toUpperCase()}]:\n${m.content}`)
    .join("\n\n---\n\n");
}

/**
 * Store pre-compaction messages as a readable transcript.
 *
 * @param chatId - The chat ID
 * @param messages - The messages to backup
 * @returns The path to the backup file
 */
export async function storePreCompactionMessages(
  chatId: number,
  messages: CompactionMessage[],
): Promise<string> {
  const chatBackupDir = getChatBackupDir(chatId);

  // Ensure directory exists
  if (!fs.existsSync(chatBackupDir)) {
    fs.mkdirSync(chatBackupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFileName = `compaction-${timestamp}.md`;
  const backupPath = path.join(chatBackupDir, backupFileName);

  const transcript = formatAsTranscript(messages);

  try {
    fs.writeFileSync(backupPath, transcript);
    logger.info(
      `Stored compaction backup for chat ${chatId}: ${messages.length} messages`,
    );
    return backupPath;
  } catch (error) {
    logger.error(
      `Failed to store compaction backup for chat ${chatId}:`,
      error,
    );
    throw error;
  }
}

/**
 * List all backup files for a chat.
 *
 * @param chatId - The chat ID
 * @returns Array of backup file paths, sorted by date (newest first)
 */
export function listChatBackups(chatId: number): string[] {
  const chatBackupDir = getChatBackupDir(chatId);

  if (!fs.existsSync(chatBackupDir)) {
    return [];
  }

  try {
    const files = fs.readdirSync(chatBackupDir);
    return files
      .filter((f) => f.startsWith("compaction-") && f.endsWith(".md"))
      .map((f) => path.join(chatBackupDir, f))
      .sort()
      .reverse(); // Newest first
  } catch (error) {
    logger.error(`Failed to list backups for chat ${chatId}:`, error);
    return [];
  }
}
