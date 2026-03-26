/**
 * Per-user settings layer for web/Node mode.
 *
 * In web mode, each user's settings are stored as an AES-256-GCM encrypted JSON blob
 * in the `userSettings` table (keyed by userId).
 *
 * In Electron mode, falls back to the global file-based readSettings() / writeSettings().
 */

import { getCurrentUser } from "@/ipc/context/user-context";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { readSettings, writeSettings, DEFAULT_SETTINGS } from "./settings";
import { webEncrypt, webDecrypt } from "./web-crypto";
import type { UserSettings } from "@/lib/schemas";

/**
 * Returns settings for the current authenticated user (web mode),
 * or the global file-based settings (Electron mode).
 */
export async function readCurrentUserSettings(): Promise<UserSettings> {
  if (process.versions?.electron) return readSettings();

  const user = getCurrentUser();
  if (!user) return readSettings();

  const row = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, user.userId),
  });

  if (!row || !row.settingsJson || row.settingsJson === "{}") {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const decrypted = webDecrypt(row.settingsJson);
    return { ...DEFAULT_SETTINGS, ...JSON.parse(decrypted) };
  } catch {
    // Corrupted or unencrypted — return defaults
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Writes a partial settings patch for the current authenticated user (web mode),
 * or to the global settings file (Electron mode).
 */
export async function writeCurrentUserSettings(
  patch: Partial<UserSettings>,
): Promise<void> {
  if (process.versions?.electron) {
    writeSettings(patch);
    return;
  }

  const user = getCurrentUser();
  if (!user) {
    writeSettings(patch);
    return;
  }

  const existing = await readCurrentUserSettings();
  const merged = { ...existing, ...patch };
  const encrypted = webEncrypt(JSON.stringify(merged));

  await db
    .insert(userSettings)
    .values({ userId: user.userId, settingsJson: encrypted })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { settingsJson: encrypted, updatedAt: new Date() },
    });
}
