-- Migration: Add api_key column to language_model_providers
-- This migration adds the api_key column that is required for storing API keys in the database

BEGIN;

-- Add api_key column if it doesn't exist
ALTER TABLE language_model_providers 
ADD COLUMN IF NOT EXISTS api_key TEXT;

-- Verify the column was added
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'language_model_providers' 
        AND column_name = 'api_key'
    ) THEN
        RAISE EXCEPTION 'Migration failed: api_key column was not created';
    END IF;
    
    RAISE NOTICE 'Migration successful: api_key column added to language_model_providers';
END $$;

COMMIT;
