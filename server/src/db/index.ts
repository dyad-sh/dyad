/**
 * Database initialization for server (PostgreSQL)
 */

import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import pkg from "pg";
import * as schema from "./schema.js";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import fs from "node:fs";

const { Pool } = pkg;

// Database connection instance
let _db: NodePgDatabase<typeof schema> | null = null;
let _pool: pkg.Pool | null = null;

/**
 * Initialize the database connection
 */
export async function initializeDatabase(): Promise<void> {
    if (_db) return;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL environment variable is not defined");
    }

    console.log("[DB] Initializing PostgreSQL connection...");

    // Create database pool
    _pool = new Pool({
        connectionString,
        ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
    });

    _pool.on("error", (err) => {
        console.error("[DB] Unexpected error on idle client", err);
        process.exit(-1);
    });

    _db = drizzle(_pool, { schema });

    // Run migrations
    try {
        const migrationsFolder = path.join(process.cwd(), "drizzle");
        if (fs.existsSync(migrationsFolder)) {
            console.log("[DB] Running migrations from:", migrationsFolder);
            await migrate(_db, { migrationsFolder });
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
export function getDb(): NodePgDatabase<typeof schema> {
    if (!_db) {
        throw new Error("Database not initialized. Call initializeDatabase() first.");
    }
    return _db;
}

/**
 * Close the database connection
 */
export async function closeDatabase(): Promise<void> {
    if (_pool) {
        await _pool.end();
        _pool = null;
        _db = null;
        console.log("[DB] Database connection closed");
    }
}

// Proxy for lazy access
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
    get(target, prop) {
        const database = getDb();
        return database[prop as keyof typeof database];
    },
});
