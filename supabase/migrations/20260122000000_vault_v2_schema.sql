-- Vault v2 MVP Schema Migration
-- This migration creates the vault_backups table and storage policies for ABBA AI cloud backup

-- ============================================
-- Storage Bucket: abba-vault
-- ============================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'abba-vault',
    'abba-vault',
    false,
    524288000, -- 500MB max file size
    ARRAY['application/zip', 'application/x-zip-compressed']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table: vault_backups
-- ============================================
CREATE TABLE IF NOT EXISTS public.vault_backups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    project_name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    size_bytes BIGINT,
    sha256 TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    app_version TEXT,
    notes TEXT,
    
    CONSTRAINT valid_status CHECK (status IN ('pending', 'uploaded', 'failed'))
);

-- Add comment for documentation
COMMENT ON TABLE public.vault_backups IS 'Stores metadata for ABBA AI project backups in Vault v2';
COMMENT ON COLUMN public.vault_backups.user_id IS 'Supabase Auth user ID who owns this backup';
COMMENT ON COLUMN public.vault_backups.storage_path IS 'Path to the zip file in abba-vault storage bucket';
COMMENT ON COLUMN public.vault_backups.status IS 'pending = upload in progress, uploaded = complete, failed = upload failed';

-- ============================================
-- Enable Row Level Security
-- ============================================
ALTER TABLE public.vault_backups ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS Policies for vault_backups
-- ============================================

-- Users can only read their own backups
CREATE POLICY "Users can read own backups"
ON public.vault_backups FOR SELECT
USING (auth.uid() = user_id);

-- Users can only insert backups with their own user_id
CREATE POLICY "Users can insert own backups"
ON public.vault_backups FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can only update their own backups
CREATE POLICY "Users can update own backups"
ON public.vault_backups FOR UPDATE
USING (auth.uid() = user_id);

-- Users can only delete their own backups
CREATE POLICY "Users can delete own backups"
ON public.vault_backups FOR DELETE
USING (auth.uid() = user_id);

-- ============================================
-- Indexes for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_vault_backups_user_id 
ON public.vault_backups(user_id);

CREATE INDEX IF NOT EXISTS idx_vault_backups_created_at 
ON public.vault_backups(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vault_backups_user_status 
ON public.vault_backups(user_id, status);

-- ============================================
-- Storage Bucket Setup (run manually in Dashboard or via API)
-- Bucket name: abba-vault
-- Access: Private (no public access)
-- ============================================

-- Note: Storage bucket creation requires Dashboard or Management API
-- The following policies should be applied after bucket creation

-- ============================================
-- Storage RLS Policies for abba-vault bucket
-- ============================================

-- Users can upload files only to their own folder (user_id prefix)
CREATE POLICY "Users can upload to own vault folder"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'abba-vault' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

-- Users can read files only from their own folder
CREATE POLICY "Users can read from own vault folder"
ON storage.objects FOR SELECT
USING (
    bucket_id = 'abba-vault' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

-- Users can update files only in their own folder
CREATE POLICY "Users can update own vault folder"
ON storage.objects FOR UPDATE
USING (
    bucket_id = 'abba-vault' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

-- Users can delete files only from their own folder
CREATE POLICY "Users can delete from own vault folder"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'abba-vault' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

-- ============================================
-- Grant necessary permissions
-- ============================================
GRANT ALL ON public.vault_backups TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
