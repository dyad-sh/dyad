// Quick migration script to create app_files table
const { Pool } = require('pg');

const connectionString = 'postgres://postgres:YOMFBjzOHTAZtfogMLYGOvp3jJTBUW7zXIQH7HFHPWC4uzW4muObmDgoNXMhZtOM@62.169.27.8:5432/dyad';

const pool = new Pool({ connectionString });

async function runMigration() {
    try {
        console.log('🔄 Connecting to database at 62.169.27.8...');

        // Create app_files table
        console.log('📝 Creating app_files table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "app_files" (
                "id" SERIAL PRIMARY KEY,
                "app_id" INTEGER NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
                "path" TEXT NOT NULL,
                "content" TEXT NOT NULL,
                "created_at" TIMESTAMP DEFAULT NOW() NOT NULL,
                "updated_at" TIMESTAMP DEFAULT NOW() NOT NULL,
                CONSTRAINT "app_files_app_path_unique" UNIQUE("app_id", "path")
            );
        `);
        console.log('✅ Table app_files created');

        // Create indexes
        console.log('📝 Creating indexes...');
        await pool.query(`
            CREATE INDEX IF NOT EXISTS "app_files_app_id_idx" ON "app_files"("app_id");
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS "app_files_path_idx" ON "app_files"("path");
        `);
        console.log('✅ Indexes created');

        // Verify
        const result = await pool.query(`
            SELECT COUNT(*) FROM app_files;
        `);
        console.log('✅ Migration completed successfully!');
        console.log(`📊 Current files count: ${result.rows[0].count}`);

        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        await pool.end();
        process.exit(1);
    }
}

runMigration();
