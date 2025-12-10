-- Migration: Add updated_at to chats table and ensure path is nullable
-- Created: 2025-12-10
-- Fixes schema inconsistencies between local and production

-- Add updated_at column to chats table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'chats' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE chats ADD COLUMN updated_at timestamp DEFAULT now() NOT NULL;
    END IF;
END $$;

-- Ensure path column is nullable in apps table
DO $$
BEGIN
    ALTER TABLE apps ALTER COLUMN path DROP NOT NULL;
EXCEPTION
    WHEN OTHERS THEN
        -- Column might already be nullable, ignore error
        NULL;
END $$;
