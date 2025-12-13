/**
 * File Service - Manages CRUD operations for app files
 */

import { getDb } from "../db/index.js";
import { app_files } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

export class FileService {
    /**
     * Save or update a file
     */
    async saveFile(appId: number, path: string, content: string): Promise<void> {
        const db = getDb();

        // Normalize path
        const normalizedPath = path.replace(/^\.?\//, '');

        // Check if file exists
        const existing = await db
            .select()
            .from(app_files)
            .where(and(eq(app_files.appId, appId), eq(app_files.path, normalizedPath)))
            .limit(1);

        if (existing.length > 0) {
            // Update existing file
            await db
                .update(app_files)
                .set({
                    content,
                    updatedAt: new Date()
                })
                .where(eq(app_files.id, existing[0].id));
        } else {
            // Insert new file
            await db.insert(app_files).values({
                appId,
                path: normalizedPath,
                content,
            });
        }
    }

    /**
     * Get file content
     */
    async getFile(appId: number, path: string): Promise<string | null> {
        const db = getDb();
        const normalizedPath = path.replace(/^\.?\//, '');

        const result = await db
            .select()
            .from(app_files)
            .where(and(eq(app_files.appId, appId), eq(app_files.path, normalizedPath)))
            .limit(1);

        return result.length > 0 ? result[0].content : null;
    }

    /**
     * List all file paths for an app
     */
    async listFiles(appId: number): Promise<string[]> {
        const db = getDb();

        const result = await db
            .select({ path: app_files.path })
            .from(app_files)
            .where(eq(app_files.appId, appId))
            .orderBy(app_files.path);

        return result.map(r => r.path);
    }

    /**
     * Delete a file
     */
    async deleteFile(appId: number, path: string): Promise<void> {
        const db = getDb();
        const normalizedPath = path.replace(/^\.?\//, '');

        await db
            .delete(app_files)
            .where(and(eq(app_files.appId, appId), eq(app_files.path, normalizedPath)));
    }

    /**
     * Update file content
     */
    async updateFile(appId: number, path: string, content: string): Promise<void> {
        await this.saveFile(appId, path, content);
    }

    /**
     * Delete all files for an app
     */
    async deleteAllFiles(appId: number): Promise<void> {
        const db = getDb();
        await db.delete(app_files).where(eq(app_files.appId, appId));
    }

    /**
     * Get file with metadata
     */
    async getFileWithMetadata(appId: number, path: string) {
        const db = getDb();
        const normalizedPath = path.replace(/^\.?\//, '');

        const result = await db
            .select()
            .from(app_files)
            .where(and(eq(app_files.appId, appId), eq(app_files.path, normalizedPath)))
            .limit(1);

        return result.length > 0 ? result[0] : null;
    }
}
