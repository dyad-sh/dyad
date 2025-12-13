#!/bin/bash
# =============================================================================
# Dyad Server - Entrypoint Script for Docker
# Runs migrations before starting the server
# =============================================================================

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[ENTRYPOINT]${NC} $1"
}

log_error() {
    echo -e "${RED}[ENTRYPOINT]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[ENTRYPOINT]${NC} $1"
}

# Wait for database to be ready
wait_for_db() {
    log_info "Waiting for database to be ready..."
    
    MAX_RETRIES=30
    RETRY_COUNT=0
    
    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if node -e "
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL
            });
            pool.query('SELECT 1')
                .then(() => { pool.end(); process.exit(0); })
                .catch(() => { pool.end(); process.exit(1); });
        " 2>/dev/null; then
            log_info "✅ Database is ready!"
            return 0
        fi
        
        RETRY_COUNT=$((RETRY_COUNT + 1))
        log_warn "Database not ready yet... (attempt $RETRY_COUNT/$MAX_RETRIES)"
        sleep 2
    done
    
    log_error "❌ Database failed to become ready after $MAX_RETRIES attempts"
    return 1
}

# Run database migrations
run_migrations() {
    log_info "Running database migrations..."
    
    if npm run migrate; then
        log_info "✅ Migrations completed successfully!"
        return 0
    else
        log_error "❌ Migration failed!"
        return 1
    fi
}

# Main execution
main() {
    log_info "Starting Dyad Server..."
    
    # Wait for database
    if ! wait_for_db; then
        log_error "Cannot start server without database"
        exit 1
    fi
    
    # Run migrations
    if ! run_migrations; then
        log_warn "Migration failed, but continuing to start server..."
        # Don't exit - allow server to start even if migration fails
        # This is useful for development and allows manual migration
    fi
    
    # Start the server
    log_info "Starting Node.js server..."
    exec npm start
}

main "$@"
