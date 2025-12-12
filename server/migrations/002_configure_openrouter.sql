-- Migration: Configure OpenRouter provider
-- This script adds OpenRouter configuration to the database

BEGIN;

-- Insert or update OpenRouter provider configuration
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
    CURRENT_TIMESTAMP)
ON CONFLICT (key)
DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;

COMMIT;

-- Verify configuration
SELECT 'OpenRouter configured successfully!' as status;
SELECT id, name, api_base_url FROM language_model_providers WHERE id = 'openrouter';
SELECT key, value FROM system_settings WHERE key = 'defaultModel';
