#!/bin/sh
# Entrypoint script to run migrations before starting the server

echo "Running database migrations..."

# Run migrations using psql
psql $DATABASE_URL << EOF
-- Add api_key column if it doesn't exist
ALTER TABLE language_model_providers ADD COLUMN IF NOT EXISTS api_key TEXT;

-- Create system_settings table if it doesn't exist
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
EOF

echo "Migrations completed!"

# Start the server
exec node dist/server/src/index.js
