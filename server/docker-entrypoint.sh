#!/bin/sh
# Entrypoint script to run migrations before starting the server

echo "Running database migrations..."

# Run migrations using psql
psql $DATABASE_URL <<EOF
-- Migration 001: Add api_key column if it doesn't exist
ALTER TABLE language_model_providers ADD COLUMN IF NOT EXISTS api_key TEXT;

-- Create system_settings table if it doesn't exist
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Migration 002: Configure OpenRouter provider
INSERT INTO language_model_providers (id, name, api_base_url, api_key, created_at, updated_at)
VALUES (
    'openrouter',
    'OpenRouter',
    'https://openrouter.ai/api/v1',
    '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',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT (id) 
DO UPDATE SET 
    api_key = EXCLUDED.api_key,
    api_base_url = EXCLUDED.api_base_url,
    updated_at = CURRENT_TIMESTAMP;

-- Set default model to DeepSeek Chat v3.1
INSERT INTO system_settings (key, value, description, created_at, updated_at)
VALUES (
    'defaultModel',
    'deepseek/deepseek-chat-v3.1:free',
    'Default AI model for chat',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT (key)
DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
EOF

echo "Migrations completed!"
echo "DeepSeek Chat v3.1 configured as default model"

# Start the server
# The TypeScript build outputs to dist/index.js at the root of dist folder
exec node dist/index.js
