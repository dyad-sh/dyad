#!/usr/bin/env node
/**
 * Run database migration for app_files table
 */

import { getDb } from './db/index.js';
import fs from 'fs';
import path from 'path';

// Get __dirname in a CommonJS-compatible way
// When compiled, this file will be at dist/migrate.js
// and we need to access dist/db/migrations/0003_add_app_files.sql
const __dirname = path.dirname(require.resolve('./db/index.js'));

async function runMigration() {
    try {
        console.log('Running migration: 0003_add_app_files.sql');

        const db = getDb();
        // Navigate from dist/db to dist/db/migrations
        const migrationPath = path.join(__dirname, 'migrations', '0003_add_app_files.sql');

        console.log('Migration path:', migrationPath);

        if (!fs.existsSync(migrationPath)) {
            console.error('❌ Migration file not found:', migrationPath);
            console.error('Current directory:', __dirname);
            process.exit(1);
        }

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
