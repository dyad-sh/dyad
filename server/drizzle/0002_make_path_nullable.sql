-- Migration: Make path column nullable in apps table for web mode support
-- Created: 2025-12-09

ALTER TABLE apps ALTER COLUMN path DROP NOT NULL;
