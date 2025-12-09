/**
 * Database initialization for server
 * Adapted from: src/db/index.ts (without Electron dependencies)
 */

import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema.js";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import fs from "node:fs";

// Database connection instance
let _db: BetterSQLite3Database<typeof schema> | null = null;
let _sqlite: Database.Database | null = null;

/**
 * Get the database path based on environment
 */
export function getDatabasePath(): string {
    const dataDir = process.env.DATA_DIR || "./data";
    return path.join(dataDir, "sqlite.db");
}

/**
 * Get the apps directory path
 */
export function getAppsPath(): string {
    const dataDir = process.env.DATA_DIR || "./data";
    return path.join(dataDir, "apps");
}

/**
 * Initialize the database connection
 */
export async function initializeDatabase(): Promise<void> {
    if (_db) return;

    const dbPath = getDatabasePath();
    const dataDir = path.dirname(dbPath);
    const appsDir = getAppsPath();

    console.log("[DB] Initializing database at:", dbPath);

    // Ensure directories exist
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(appsDir)) {
        fs.mkdirSync(appsDir, { recursive: true });
    }

    // Check if the database file exists and remove it if corrupted
    try {
        if (fs.existsSync(dbPath)) {
            const stats = fs.statSync(dbPath);
            if (stats.size < 100) {
                console.log("[DB] Database file may be corrupted. Removing...");
                fs.unlinkSync(dbPath);
            }
        }
    } catch (error) {
        console.error("[DB] Error checking database file:", error);
    }

    // Create database connection
    _sqlite = new Database(dbPath, { timeout: 10000 });
    _sqlite.pragma("foreign_keys = ON");
    _sqlite.pragma("journal_mode = WAL");

    _db = drizzle(_sqlite, { schema });

    // Run migrations
    try {
        const migrationsFolder = path.join(process.cwd(), "drizzle");
        if (fs.existsSync(migrationsFolder)) {
            console.log("[DB] Running migrations from:", migrationsFolder);
            migrate(_db, { migrationsFolder });
        } else {
            console.log("[DB] No migrations folder found, skipping migrations");
        }
    } catch (error) {
        console.error("[DB] Migration error:", error);
    }

    console.log("[DB] Database initialized successfully");
}

/**
 * Get the database instance (throws if not initialized)
 */
export function getDb(): BetterSQLite3Database<typeof schema> {
    if (!_db) {
        throw new Error("Database not initialized. Call initializeDatabase() first.");
    }
    return _db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
    if (_sqlite) {
        _sqlite.close();
        _sqlite = null;
        _db = null;
        console.log("[DB] Database connection closed");
    }
}

// Proxy for lazy access
export const db = new Proxy({} as BetterSQLite3Database<typeof schema>, {
    get(target, prop) {
        const database = getDb();
        return database[prop as keyof typeof database];
    },
});
