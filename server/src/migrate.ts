#!/usr/bin/env node
/**
 * Run database migration for app_files table
 */

import { getDb } from './db/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
    try {
        console.log('Running migration: 0003_add_app_files.sql');

        const db = getDb();
        const migrationPath = path.join(__dirname, 'db', 'migrations', '0003_add_app_files.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');

        // Split by semicolon and execute each statement
        const statements = sql.split(';').filter(s => s.trim());

        for (const statement of statements) {
            if (statement.trim()) {
                await db.execute(statement);
                console.log('✓ Executed statement');
            }
        }

        console.log('✅ Migration completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

runMigration();
