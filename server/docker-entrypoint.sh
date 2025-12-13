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
