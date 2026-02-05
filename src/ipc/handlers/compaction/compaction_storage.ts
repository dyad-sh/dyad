/**
 * Compaction Storage Module
 * Handles storing and retrieving original (pre-compaction) messages.
 */

import fs from "node:fs";
import path from "node:path";
import { getUserDataPath } from "@/paths/paths";
import log from "electron-log";

const logger = log.scope("compaction_storage");

/**
 * Structure of a compaction backup file.
 */
export interface CompactionBackup {
  chatId: number;
  compactedAt: string;
  totalTokensAtCompaction: number;
  messageCount: number;
  messages: CompactionMessage[];
}

/**
 * Message structure stored in backup files.
 */
export interface CompactionMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string | null;
  aiMessagesJson: unknown | null;
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
 * Store pre-compaction messages to a backup file.
 *
 * @param chatId - The chat ID
 * @param messages - The messages to backup
 * @param totalTokens - Total tokens at time of compaction
 * @returns The path to the backup file
 */
export async function storePreCompactionMessages(
  chatId: number,
  messages: CompactionMessage[],
  totalTokens: number,
): Promise<string> {
  const chatBackupDir = getChatBackupDir(chatId);

  // Ensure directory exists
  if (!fs.existsSync(chatBackupDir)) {
    fs.mkdirSync(chatBackupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFileName = `compaction-${timestamp}.json`;
  const backupPath = path.join(chatBackupDir, backupFileName);

  const backup: CompactionBackup = {
    chatId,
    compactedAt: new Date().toISOString(),
    totalTokensAtCompaction: totalTokens,
    messageCount: messages.length,
    messages,
  };

  try {
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
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
 * Load pre-compaction messages from a backup file.
 *
 * @param backupPath - Path to the backup file
 * @returns The backup data or null if not found
 */
export async function loadPreCompactionMessages(
  backupPath: string,
): Promise<CompactionBackup | null> {
  try {
    if (!fs.existsSync(backupPath)) {
      logger.warn(`Compaction backup not found: ${backupPath}`);
      return null;
    }

    const content = fs.readFileSync(backupPath, "utf-8");
    return JSON.parse(content) as CompactionBackup;
  } catch (error) {
    logger.error(`Failed to load compaction backup: ${backupPath}`, error);
    return null;
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
      .filter((f) => f.startsWith("compaction-") && f.endsWith(".json"))
      .map((f) => path.join(chatBackupDir, f))
      .sort()
      .reverse(); // Newest first
  } catch (error) {
    logger.error(`Failed to list backups for chat ${chatId}:`, error);
    return [];
  }
}
