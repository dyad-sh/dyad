# Vault v2 Installed App Testing Guide

This document provides step-by-step instructions for testing Vault v2 in the **installed ABBA AI app** (not dev mode).

## Prerequisites

- ABBA AI v0.2.4+ installed
- Supabase project with Vault v2 schema deployed
- Test user account (or create one during testing)

## Installation

Download and install from [GitHub Releases](https://github.com/yosiwizman/dyad/releases/tag/v0.2.4):

| Platform              | File                             |
| --------------------- | -------------------------------- |
| Windows               | `ABBA.AI-0.2.4.Setup.exe`        |
| macOS (Apple Silicon) | `ABBA.AI-darwin-arm64-0.2.4.zip` |
| macOS (Intel)         | `ABBA.AI-darwin-x64-0.2.4.zip`   |

---

## Test 1: Initial Configuration

**Goal:** Verify Vault configuration UI works correctly.

### Steps

1. Launch ABBA AI
2. Navigate to **Settings → Integrations**
3. Scroll to **Vault (Cloud Backup)** section
4. Verify you see the Vault Configuration form with:
   - Supabase Project URL input
   - Publishable Key (anon key) input
   - Save button
   - Test Connection button

### Expected Results

- [ ] Configuration UI is visible
- [ ] URL and key inputs accept text
- [ ] Save button is initially disabled (no changes)
- [ ] Status badge shows "Not tested"

---

## Test 2: Save Configuration

**Goal:** Verify Vault settings can be saved.

### Steps

1. Enter your Supabase Project URL (e.g., `https://your-project.supabase.co`)
2. Enter your publishable/anon key (starts with `eyJ...`)
3. Click **Save**

### Expected Results

- [ ] Success toast: "Vault settings saved"
- [ ] Save button becomes disabled (no unsaved changes)
- [ ] Key field shows placeholder with masked value (e.g., `Current: ***...abc123`)

---

## Test 3: Sign In to Vault

**Goal:** Verify Vault authentication works.

### Steps

1. After saving config, you should see the **Sign in to Vault** section
2. Enter your email address
3. Enter your password
4. Click **Sign In**

### Expected Results

- [ ] Success toast: "Signed in to Vault"
- [ ] UI changes to show "Signed in to Vault" with your email
- [ ] Green checkmark icon appears
- [ ] Sign Out button is visible

---

## Test 4: Sign Up (New Users)

**Goal:** Verify new user registration works.

### Steps

1. Click "Need an account? Sign up"
2. Enter new email address
3. Enter password (min 6 characters)
4. Click **Create Account**

### Expected Results

- [ ] If email confirmation required: Message to check email
- [ ] If auto-confirmed: Success toast and signed-in state
- [ ] Email visible in signed-in status

---

## Test 5: Test Connection

**Goal:** Verify connection to Vault backend.

### Steps

1. While signed in, click gear icon to show Settings panel
2. Click **Test Connection**

### Expected Results

- [ ] Success toast: "Successfully connected to Vault"
- [ ] Status badge shows "Connected" (green)

---

## Test 6: Create Backup

**Goal:** Verify backup creation works end-to-end.

### Steps

1. Create or open a project in ABBA AI
2. In the project, find the **Backup to Vault** button
3. Click to create a backup
4. Optionally add notes

### Expected Results

- [ ] Progress indicator shows stages (Preparing, Uploading, Confirming)
- [ ] Success toast when complete
- [ ] Backup appears in Vault backup list
- [ ] Verify in Supabase Dashboard:
  - `vault_backups` table has new row with status "uploaded"
  - `abba-vault` bucket has corresponding .zip file

---

## Test 7: Restore Backup

**Goal:** Verify backup restoration works.

### Steps

1. Go to Vault backup list
2. Find a backup to restore
3. Click **Restore**
4. Select target location

### Expected Results

- [ ] Progress indicator shows stages (Downloading, Extracting)
- [ ] Files restored to selected location
- [ ] Project is functional after restore

---

## Test 8: Persistence After Restart (CRITICAL)

**Goal:** Verify settings and auth session persist across app restarts.

### Steps

1. Ensure you are signed in to Vault
2. Note your email and connection status
3. **Completely quit ABBA AI** (not just minimize)
   - Windows: Close window or Ctrl+Q
   - macOS: Cmd+Q
4. **Restart ABBA AI**
5. Navigate to **Settings → Integrations → Vault**

### Expected Results

- [ ] URL is still configured (not empty)
- [ ] Key shows masked value (still configured)
- [ ] You are **still signed in** (shows email)
- [ ] Status badge shows "Connected" or auth status
- [ ] **NO** "Sign in to Supabase above" message
- [ ] Backup list loads (if you have backups)

---

## Test 9: Sign Out

**Goal:** Verify sign out works correctly.

### Steps

1. While signed in, click **Sign Out**

### Expected Results

- [ ] Success toast: "Signed out from Vault"
- [ ] UI shows sign-in form again
- [ ] Sign In button is visible
- [ ] Config (URL/key) is still saved

---

## Test 10: Copy Diagnostics

**Goal:** Verify diagnostics contain correct info and mask secrets.

### Steps

1. In Vault settings, click **Copy Diagnostics**
2. Paste into a text editor

### Expected Results

- [ ] Timestamp is present
- [ ] URL is shown in full
- [ ] Key is **masked** (shows `***...XXXXXX`)
- [ ] isAuthenticated reflects actual state
- [ ] No raw tokens or secrets visible

---

## Troubleshooting

### "Invalid channel" error

The IPC channel is not in the preload allowlist. This should not happen in v0.2.4+.

**Fix:** Ensure you have v0.2.4 or later installed.

### "Invalid or expired token" error

Your session expired and auto-refresh failed.

**Fix:** Sign out and sign in again.

### Config not persisting after restart

Settings file may be corrupted.

**Fix:** Check `%APPDATA%/abba-ai/user-settings.json` (Windows) or `~/Library/Application Support/abba-ai/user-settings.json` (macOS).

### Cannot sign in

- Verify email and password are correct
- Check Supabase Auth settings allow email/password sign-in
- Verify Supabase project URL and anon key are correct

---

## Checklist Summary

| Test                         | Status |
| ---------------------------- | ------ |
| 1. Initial Configuration     | ⬜     |
| 2. Save Configuration        | ⬜     |
| 3. Sign In                   | ⬜     |
| 4. Sign Up (optional)        | ⬜     |
| 5. Test Connection           | ⬜     |
| 6. Create Backup             | ⬜     |
| 7. Restore Backup            | ⬜     |
| 8. Persistence After Restart | ⬜     |
| 9. Sign Out                  | ⬜     |
| 10. Copy Diagnostics         | ⬜     |

---

**Version:** v0.2.4
**Last Updated:** January 2026
