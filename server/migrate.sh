#!/bin/bash
# =============================================================================
# Database Migration Script
# Runs all pending migrations in order
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[MIGRATE]${NC} $1"
}

log_error() {
    echo -e "${RED}[MIGRATE]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[MIGRATE]${NC} $1"
}

# Wait for database to be ready
wait_for_db() {
    log_info "Waiting for database to be ready..."
    
    MAX_RETRIES=30
    RETRY_COUNT=0
    
    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if node -e "
            const { getDb } = require('./dist/db/index.js');
            getDb().execute('SELECT 1')
                .then(() => process.exit(0))
                .catch(() => process.exit(1));
        " 2>/dev/null; then
            log_info "Database is ready!"
            return 0
        fi
        
        RETRY_COUNT=$((RETRY_COUNT + 1))
        log_warn "Database not ready yet... (attempt $RETRY_COUNT/$MAX_RETRIES)"
        sleep 2
    done
    
    log_error "Database failed to become ready after $MAX_RETRIES attempts"
    return 1
}

# Run migrations
run_migrations() {
    log_info "Running database migrations..."
    
    # Check if dist/migrate.js exists
    if [ ! -f "dist/migrate.js" ]; then
        log_error "Migration script not found. Please build the project first."
        exit 1
    fi
    
    # Run the migration
    if node dist/migrate.js; then
        log_info "✅ All migrations completed successfully!"
        return 0
    else
        log_error "❌ Migration failed!"
        return 1
    fi
}

# Main execution
main() {
    log_info "Starting database migration process..."
    
    # Wait for database
    if ! wait_for_db; then
        exit 1
    fi
    
    # Run migrations
    if ! run_migrations; then
        exit 1
    fi
    
    log_info "Migration process completed!"
}

main "$@"
