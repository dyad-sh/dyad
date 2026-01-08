import { getDb } from "@/db";
import { extensionData } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import log from "electron-log";

const logger = log.scope("extension-data");

/**
 * Set extension-specific data for an app
 */
export async function setExtensionData(
  extensionId: string,
  appId: number,
  key: string,
  value: any,
): Promise<void> {
  const db = getDb();

  try {
    // Check if record exists
    const existing = await db
      .select()
      .from(extensionData)
      .where(
        and(
          eq(extensionData.appId, appId),
          eq(extensionData.extensionId, extensionId),
          eq(extensionData.key, key),
        ),
      )
      .limit(1);

    const now = Math.floor(Date.now() / 1000);

    if (existing.length > 0) {
      // Update existing record
      await db
        .update(extensionData)
        .set({
          value: JSON.stringify(value),
          updatedAt: new Date(now * 1000),
        })
        .where(
          and(
            eq(extensionData.appId, appId),
            eq(extensionData.extensionId, extensionId),
            eq(extensionData.key, key),
          ),
        );
    } else {
      // Insert new record
      await db.insert(extensionData).values({
        appId,
        extensionId,
        key,
        value: JSON.stringify(value),
        createdAt: new Date(now * 1000),
        updatedAt: new Date(now * 1000),
      });
    }
  } catch (error) {
    logger.error(`Error setting extension data for ${extensionId}:`, error);
    throw error;
  }
}

/**
 * Get extension-specific data for an app
 */
export async function getExtensionData(
  extensionId: string,
  appId: number,
  key: string,
): Promise<any> {
  const db = getDb();

  try {
    const result = await db
      .select()
      .from(extensionData)
      .where(
        and(
          eq(extensionData.appId, appId),
          eq(extensionData.extensionId, extensionId),
          eq(extensionData.key, key),
        ),
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const record = result[0];
    if (!record.value) {
      return null;
    }

    try {
      return JSON.parse(record.value);
    } catch (parseError) {
      // Handle invalid JSON gracefully (consistent with getAllExtensionData)
      logger.warn(
        `Invalid JSON in extension data for ${extensionId}, app ${appId}, key "${key}":`,
        parseError,
      );
      return null;
    }
  } catch (error) {
    logger.error(`Error getting extension data for ${extensionId}:`, error);
    throw error;
  }
}

/**
 * Get all extension data for an app
 */
export async function getAllExtensionData(
  extensionId: string,
  appId: number,
): Promise<Record<string, any>> {
  const db = getDb();

  try {
    const results = await db
      .select()
      .from(extensionData)
      .where(
        and(
          eq(extensionData.appId, appId),
          eq(extensionData.extensionId, extensionId),
        ),
      );

    const data: Record<string, any> = {};
    for (const record of results) {
      if (record.value) {
        try {
          data[record.key] = JSON.parse(record.value);
        } catch (parseError) {
          // Skip invalid JSON (consistent with getExtensionData)
          logger.warn(
            `Invalid JSON in extension data for ${extensionId}, app ${appId}, key "${record.key}":`,
            parseError,
          );
        }
      }
    }

    return data;
  } catch (error) {
    logger.error(`Error getting all extension data for ${extensionId}:`, error);
    throw error;
  }
}

/**
 * Delete extension data for an app
 */
export async function deleteExtensionData(
  extensionId: string,
  appId: number,
  key?: string,
): Promise<void> {
  const db = getDb();

  try {
    if (key) {
      // Delete specific key
      await db
        .delete(extensionData)
        .where(
          and(
            eq(extensionData.appId, appId),
            eq(extensionData.extensionId, extensionId),
            eq(extensionData.key, key),
          ),
        );
    } else {
      // Delete all data for this extension and app
      await db
        .delete(extensionData)
        .where(
          and(
            eq(extensionData.appId, appId),
            eq(extensionData.extensionId, extensionId),
          ),
        );
    }
  } catch (error) {
    logger.error(`Error deleting extension data for ${extensionId}:`, error);
    throw error;
  }
}
