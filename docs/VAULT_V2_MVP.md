# Vault v2 MVP - Cloud Backup & Restore

## Overview

Vault v2 provides authenticated cloud backup and restore functionality for ABBA AI projects using Supabase infrastructure (Auth + Postgres + Storage + Edge Functions).

## Architecture

### Security Model

1. **Authentication**: Users authenticate via Supabase Auth (existing OAuth flow through Supabase organizations)
2. **Storage**: Private bucket `abba-vault` with Row Level Security (RLS) policies
3. **Edge Functions**: JWT-protected endpoints for all operations
4. **Data Flow**: Signed URLs for direct client-to-Storage uploads/downloads (no proxy needed)

### Components

```
┌──────────────────────────────────────────────────────────────────────┐
│                           ABBA AI Desktop                            │
├──────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ Vault UI    │  │ Vault Client│  │ IPC Handlers│  │ Zip Utils   │ │
│  │ Components  │  │             │  │             │  │             │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        Supabase Infrastructure                       │
├──────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────┐  ┌─────────────────────────────────────┐│
│  │     Edge Functions      │  │           Postgres                  ││
│  │  ┌───────────────────┐  │  │  ┌─────────────────────────────┐   ││
│  │  │ vault-signed-     │  │  │  │      vault_backups          │   ││
│  │  │ upload            │  │  │  │  - id (uuid pk)             │   ││
│  │  └───────────────────┘  │  │  │  - user_id (uuid)           │   ││
│  │  ┌───────────────────┐  │  │  │  - project_name (text)      │   ││
│  │  │ vault-signed-     │  │  │  │  - storage_path (text)      │   ││
│  │  │ download          │  │  │  │  - size_bytes (bigint)      │   ││
│  │  └───────────────────┘  │  │  │  - sha256 (text)            │   ││
│  │  ┌───────────────────┐  │  │  │  - status (text)            │   ││
│  │  │ vault-confirm-    │  │  │  │  - created_at (timestamptz) │   ││
│  │  │ upload            │  │  │  │  - app_version (text)       │   ││
│  │  └───────────────────┘  │  │  │  - notes (text)             │   ││
│  │  ┌───────────────────┐  │  │  └─────────────────────────────┘   ││
│  │  │ vault-list-       │  │  │                                     ││
│  │  │ backups           │  │  │  RLS: users can only access own rows││
│  │  └───────────────────┘  │  └─────────────────────────────────────┘│
│  │  ┌───────────────────┐  │                                         │
│  │  │ vault-delete-     │  │  ┌─────────────────────────────────────┐│
│  │  │ backup            │  │  │           Storage                   ││
│  │  └───────────────────┘  │  │  Bucket: abba-vault (private)       ││
│  └─────────────────────────┘  │  Path: {user_id}/{timestamp}-{name} ││
│                               │  RLS: users can only access own path││
│                               └─────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
```

## Data Flows

### Backup Flow

```
1. User clicks "Backup Now" in Vault UI
2. Desktop app exports project to zip file (deterministic)
3. Desktop computes SHA256 hash of zip
4. Desktop calls vault-signed-upload Edge Function with:
   - projectName, sizeBytes, sha256
   - Auth: JWT token
5. Edge Function:
   - Validates JWT
   - Generates storage path: {userId}/{timestamp}-{safeProjectName}.zip
   - Creates signed upload URL (2h validity)
   - Inserts vault_backups row (status='pending')
   - Returns: { backupId, signedUrl, path }
6. Desktop uploads zip directly to Storage using signed URL
7. Desktop calls vault-confirm-upload with backupId
8. Edge Function updates status to 'uploaded'
```

### Restore Flow

```
1. User selects backup from list and clicks "Restore"
2. Desktop calls vault-signed-download Edge Function with:
   - backupId
   - Auth: JWT token
3. Edge Function:
   - Validates JWT
   - Verifies backup belongs to user
   - Creates signed download URL
   - Returns: { signedUrl, projectName, sha256 }
4. Desktop downloads zip directly from Storage
5. Desktop verifies SHA256 hash
6. Desktop imports project from zip
```

## Database Schema

```sql
-- Table: vault_backups
CREATE TABLE public.vault_backups (
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

-- Enable RLS
ALTER TABLE public.vault_backups ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can read own backups"
ON public.vault_backups FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own backups"
ON public.vault_backups FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own backups"
ON public.vault_backups FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own backups"
ON public.vault_backups FOR DELETE
USING (auth.uid() = user_id);

-- Index for performance
CREATE INDEX idx_vault_backups_user_id ON public.vault_backups(user_id);
CREATE INDEX idx_vault_backups_created_at ON public.vault_backups(created_at DESC);
```

## Storage Policies

```sql
-- Storage bucket: abba-vault (create via Supabase Dashboard)
-- Access: Private (no public access)

-- Storage RLS policies (applied to storage.objects)
CREATE POLICY "Users can upload to own folder"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'abba-vault' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can read from own folder"
ON storage.objects FOR SELECT
USING (
    bucket_id = 'abba-vault' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete from own folder"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'abba-vault' AND
    (storage.foldername(name))[1] = auth.uid()::text
);
```

## Edge Functions

### vault-signed-upload

- **Endpoint**: `POST /functions/v1/vault-signed-upload`
- **Auth**: Required (JWT)
- **Input**:
  ```json
  {
    "projectName": "my-app",
    "sizeBytes": 1048576,
    "sha256": "abc123..."
  }
  ```
- **Output**:
  ```json
  {
    "backupId": "uuid",
    "path": "user-id/timestamp-my-app.zip",
    "signedUrl": "https://...",
    "token": "upload-token"
  }
  ```

### vault-signed-download

- **Endpoint**: `POST /functions/v1/vault-signed-download`
- **Auth**: Required (JWT)
- **Input**:
  ```json
  {
    "backupId": "uuid"
  }
  ```
- **Output**:
  ```json
  {
    "signedUrl": "https://...",
    "projectName": "my-app",
    "sha256": "abc123...",
    "sizeBytes": 1048576
  }
  ```

### vault-confirm-upload

- **Endpoint**: `POST /functions/v1/vault-confirm-upload`
- **Auth**: Required (JWT)
- **Input**:
  ```json
  {
    "backupId": "uuid"
  }
  ```
- **Output**:
  ```json
  {
    "success": true
  }
  ```

### vault-list-backups

- **Endpoint**: `GET /functions/v1/vault-list-backups`
- **Auth**: Required (JWT)
- **Output**:
  ```json
  {
    "backups": [
      {
        "id": "uuid",
        "projectName": "my-app",
        "sizeBytes": 1048576,
        "sha256": "abc123...",
        "status": "uploaded",
        "createdAt": "2024-01-01T00:00:00Z",
        "appVersion": "0.1.12",
        "notes": "..."
      }
    ]
  }
  ```

### vault-delete-backup

- **Endpoint**: `POST /functions/v1/vault-delete-backup`
- **Auth**: Required (JWT)
- **Input**:
  ```json
  {
    "backupId": "uuid"
  }
  ```
- **Output**:
  ```json
  {
    "success": true
  }
  ```

## Manual Setup Steps (for Supabase Admin)

### 1. Create Supabase Project (if not exists)

Use an existing Supabase project or create a new one for ABBA Vault.

### 2. Create Storage Bucket

1. Go to Supabase Dashboard → Storage
2. Create new bucket named `abba-vault`
3. Set to **Private** (no public access)
4. Enable file size limit (recommended: 100MB)

### 3. Run SQL Migration

Execute the SQL migration in `supabase/migrations/vault_v2_schema.sql`:
1. Go to Supabase Dashboard → SQL Editor
2. Paste and run the migration SQL

### 4. Deploy Edge Functions

```bash
# From the project root
supabase functions deploy vault-signed-upload --no-verify-jwt=false
supabase functions deploy vault-signed-download --no-verify-jwt=false
supabase functions deploy vault-confirm-upload --no-verify-jwt=false
supabase functions deploy vault-list-backups --no-verify-jwt=false
supabase functions deploy vault-delete-backup --no-verify-jwt=false
```

**Important**: Do NOT use `--no-verify-jwt` flag. Functions must verify JWT.

### 5. Configure CORS (if needed)

If using custom domains, configure CORS in Supabase Dashboard → Settings → API.

### 6. Provide App Configuration

The desktop app needs:
- `SUPABASE_VAULT_URL`: Project URL (e.g., `https://xxx.supabase.co`)
- `SUPABASE_VAULT_ANON_KEY`: Anon/public key for the project

## Security Considerations

1. **JWT Verification**: All Edge Functions require valid JWT tokens
2. **Path Isolation**: Storage paths include user ID prefix, enforced by RLS
3. **Server-side Path Generation**: Clients cannot choose arbitrary paths
4. **Status Tracking**: Prevents orphaned uploads via pending/uploaded states
5. **Hash Verification**: SHA256 ensures data integrity on restore
6. **No Secrets in Client**: Only public anon key used; auth via JWT

## Error Handling

| Error | Cause | Resolution |
|-------|-------|------------|
| 401 Unauthorized | Invalid/expired JWT | Re-authenticate via Supabase |
| 403 Forbidden | RLS policy violation | User doesn't own resource |
| 404 Not Found | Backup doesn't exist | Check backup ID |
| 413 Payload Too Large | File exceeds limit | Reduce backup size |
| 500 Internal Error | Server issue | Retry or contact support |

## Version History

- **v2.0.0** (MVP): Initial implementation with signed URL uploads
