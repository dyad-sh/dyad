-- Migration: Add templateId column to apps table
-- Created: 2025-12-15

ALTER TABLE apps ADD COLUMN IF NOT EXISTS template_id TEXT;

COMMENT ON COLUMN apps.template_id IS 'Template used to create this app (next, react, etc.)';
