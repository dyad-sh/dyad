#!/bin/sh
# =============================================================================
# Docker Entrypoint Script
# Runs database migrations before starting the server
# =============================================================================

set -e

echo "[ENTRYPOINT] Starting Dyad Server..."

# Wait for database to be ready
echo "[ENTRYPOINT] Waiting for database to be ready..."
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    # Diagnostic: Resolve hostname
    echo "[ENTRYPOINT] Diagnostic: Converting DATABASE_URL hostname to IP..."
    node -e "
        const url = require('url');
        const dns = require('dns');
        try {
            const dbUrl = process.env.DATABASE_URL;
            if (!dbUrl) throw new Error('DATABASE_URL not set');
            const hostname = new url.URL(dbUrl).hostname;
            console.log('Hostname:', hostname);
            dns.lookup(hostname, (err, address) => {
                if (err) console.error('DNS Lookup Failed:', err);
                else console.log('DNS Lookup Success:', address);
            });
        } catch (e) {
            console.error('URL Parse Error:', e.message);
        }
    " 2>/dev/null

    if node -e "
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        pool.query('SELECT 1')
            .then(() => { pool.end(); process.exit(0); })
            .catch(() => { pool.end(); process.exit(1); });
    " 2>/dev/null; then
        echo "[ENTRYPOINT] ✅ Database is ready!"
        break
    fi
    
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "[ENTRYPOINT] Database not ready yet... (attempt $RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "[ENTRYPOINT] ❌ Database failed to become ready after $MAX_RETRIES attempts"
    echo "[ENTRYPOINT] Starting server anyway (migrations will fail)..."
fi

# Run database migrations
echo "[ENTRYPOINT] Running database migrations..."
if node dist/migrate.js 2>/dev/null; then
    echo "[ENTRYPOINT] ✅ Migrations completed successfully!"
else
    echo "[ENTRYPOINT] ⚠️  Migration failed or no migrations to run"
    echo "[ENTRYPOINT] Continuing to start server..."
fi

# Start the server
echo "[ENTRYPOINT] Starting Node.js server..."
exec node dist/index.js
