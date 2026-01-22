# Vault v2 MVP Smoke Test Guide

This document provides step-by-step instructions for verifying the Vault v2 deployment.

## Prerequisites

- Supabase project: `shyspsgqbhiuntdjgfro`
- Project URL: `https://shyspsgqbhiuntdjgfro.supabase.co`
- Dashboard: https://supabase.com/dashboard/project/shyspsgqbhiuntdjgfro

## 1. Verify Database Schema

Open the Supabase Dashboard → Table Editor and confirm:

- [ ] Table `vault_backups` exists with columns:

  - `id` (UUID, primary key)
  - `user_id` (UUID, not null)
  - `project_name` (TEXT, not null)
  - `storage_path` (TEXT, not null)
  - `size_bytes` (BIGINT)
  - `sha256` (TEXT)
  - `status` (TEXT, default 'pending')
  - `created_at` (TIMESTAMPTZ)
  - `app_version` (TEXT)
  - `notes` (TEXT)

- [ ] RLS is enabled on `vault_backups`
- [ ] 4 RLS policies exist: read, insert, update, delete (all scoped to `auth.uid() = user_id`)

## 2. Verify Storage Bucket

Open the Supabase Dashboard → Storage and confirm:

- [ ] Bucket `abba-vault` exists
- [ ] Bucket is **private** (no public access)
- [ ] File size limit: 500MB
- [ ] Allowed MIME types: `application/zip`, `application/x-zip-compressed`

## 3. Verify Edge Functions

Open the Supabase Dashboard → Edge Functions and confirm all 5 functions are deployed:

- [ ] `vault-signed-upload` - Active
- [ ] `vault-signed-download` - Active
- [ ] `vault-confirm-upload` - Active
- [ ] `vault-list-backups` - Active
- [ ] `vault-delete-backup` - Active

## 4. Test Edge Functions via CLI

### 4.1 Get a Test JWT Token

1. Create a test user via Supabase Dashboard → Authentication → Users → Add user
2. Use the Supabase JS client or API to sign in and get an access token

### 4.2 Test vault-list-backups (empty list)

```bash
curl -X POST https://shyspsgqbhiuntdjgfro.supabase.co/functions/v1/vault-list-backups \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

Expected response:

```json
{ "backups": [] }
```

### 4.3 Test vault-signed-upload

```bash
curl -X POST https://shyspsgqbhiuntdjgfro.supabase.co/functions/v1/vault-signed-upload \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"projectName":"test-project","sizeBytes":1024}'
```

Expected response:

```json
{
  "backupId": "uuid-here",
  "signedUrl": "https://...",
  "storagePath": "user-id/uuid/test-project.zip"
}
```

### 4.4 Test Full Backup Flow (Desktop App)

1. Launch ABBA AI desktop app
2. Navigate to Settings → Vault
3. Sign in with Supabase Auth
4. Create a test project
5. Click "Backup to Vault"
6. Verify backup appears in the backup list
7. Test restore by clicking "Restore"

## 5. Security Verification

### 5.1 RLS Test - Unauthorized Access

Try to access another user's backup (should fail):

```sql
-- In Supabase SQL Editor (as different user or anonymous)
SELECT * FROM vault_backups WHERE user_id != auth.uid();
-- Should return 0 rows due to RLS
```

### 5.2 Storage Policy Test

Try to upload to another user's folder (should fail):

```bash
# This should return 403 Forbidden
curl -X PUT "SIGNED_URL_FOR_DIFFERENT_USER" \
  -H "Content-Type: application/zip" \
  --data-binary @test.zip
```

## 6. Cleanup Test Data

After smoke testing, clean up test data:

```sql
-- Delete test backups (run as the test user)
DELETE FROM vault_backups WHERE project_name = 'test-project';
```

Also delete test files from Storage bucket via Dashboard.

## Smoke Test Checklist Summary

| Component             | Status |
| --------------------- | ------ |
| vault_backups table   | ⬜     |
| RLS policies          | ⬜     |
| abba-vault bucket     | ⬜     |
| Storage policies      | ⬜     |
| vault-signed-upload   | ⬜     |
| vault-signed-download | ⬜     |
| vault-confirm-upload  | ⬜     |
| vault-list-backups    | ⬜     |
| vault-delete-backup   | ⬜     |
| E2E backup flow       | ⬜     |
| E2E restore flow      | ⬜     |

## 7. Verify Vault Settings UI (Installed App)

This step verifies the Vault Settings UI works correctly in the **packaged/installed app**
(not just `npm start`).

### 7.1 Test Connection Button

1. Install the app from a release build (Windows Setup.exe or macOS zip)
2. Launch the installed app
3. Navigate to **Settings → Integrations → Vault**
4. Enter your Supabase URL and publishable key
5. Click **Save**
6. Click **Test Connection**
7. Verify: **No "Invalid channel" error** appears
8. Verify: Status pill shows one of:
   - ✅ "Connected" (green) - if authenticated
   - ⚠️ "Needs login" (amber) - if Supabase auth required
   - ❌ "Invalid URL" or "Invalid key" (red) - if config is wrong

### 7.2 Copy Diagnostics

1. Click **Copy Diagnostics** button
2. Paste into a text editor
3. Verify: Key is **masked** (shows `***...XXXXXX`)
4. Verify: URL is shown in full
5. Verify: No IPC errors

### 7.3 Expected IPC Channels

All these Vault channels should work without "Invalid channel" errors:

- `vault:get-settings`
- `vault:save-settings`
- `vault:test-connection`
- `vault:get-diagnostics`
- `vault:get-status`
- `vault:get-config`
- `vault:list-backups`
- `vault:create-backup`
- `vault:restore-backup`
- `vault:delete-backup`

## Troubleshooting

### "Invalid channel: vault:xxx" error

This error means the IPC channel is not in the preload allowlist.

**Fix:** Add the channel to `validInvokeChannels` in `src/preload.ts`

Example:

```typescript
const validInvokeChannels = [
  // ... existing channels
  "vault:test-connection", // Add this
];
```

Then rebuild the app.

### "JWT token is invalid" error

- Ensure the JWT token is fresh (not expired)
- Verify the token was issued by this Supabase project

### "Bucket not found" error

- Verify `abba-vault` bucket exists in Storage
- Check bucket name spelling (case-sensitive)

### "Permission denied" storage error

- Verify storage RLS policies are correctly applied
- Ensure the user_id folder matches the authenticated user

### Edge Function returns 500

- Check Edge Function logs in Dashboard → Edge Functions → [function] → Logs
- Verify environment variables are set correctly
