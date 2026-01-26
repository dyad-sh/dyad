# Vault Zero-Config Setup

This document explains how ABBA AI's Vault (cloud backup) feature works out-of-the-box without requiring users to configure anything.

## Overview

Vault is ABBA AI's cloud backup feature that allows users to backup and restore their apps to/from a Supabase-powered backend. Starting with v0.2.7, Vault supports **zero-configuration** mode:

- **No user input required**: The app auto-connects to the configured Supabase project
- **Anonymous authentication**: Users can use Vault immediately without creating an account
- **Transparent session management**: Tokens are automatically refreshed

## How It Works

### 1. Build-Time Configuration Injection

During the release build process, GitHub Actions injects the Supabase credentials via environment variables:

```
ABBA_VAULT_SUPABASE_URL=https://<project-ref>.supabase.co
ABBA_VAULT_SUPABASE_ANON_KEY=eyJ...
```

These are injected from GitHub Secrets (never committed to the repository).

### 2. Auto-Configuration on First Use

When a user first accesses Vault features, the app:

1. Checks if Vault is already configured (from previous manual setup)
2. If not configured, automatically populates settings from the injected environment variables
3. Persists the configuration to user settings (encrypted)

### 3. Anonymous Authentication

If no user session exists, the app automatically signs in anonymously:

1. Calls Supabase Auth's anonymous sign-in endpoint
2. Receives access and refresh tokens
3. Stores encrypted tokens locally
4. Auto-refreshes tokens before expiry

Anonymous users have a valid `auth.uid()` and can use RLS-protected resources.

## Setting Up GitHub Secrets

To enable zero-config for your fork/deployment:

1. Go to your GitHub repository → Settings → Secrets and variables → Actions
2. Add the following secrets:

| Secret Name                    | Description               | Example                     |
| ------------------------------ | ------------------------- | --------------------------- |
| `ABBA_VAULT_SUPABASE_URL`      | Your Supabase project URL | `https://xxxxx.supabase.co` |
| `ABBA_VAULT_SUPABASE_ANON_KEY` | Supabase anon/public key  | `eyJhbGciOiJIUzI1NiIs...`   |

**Important:** Only use the **anon/public key**, never the service_role key.

## Supabase Project Requirements

Your Supabase project must have:

1. **Anonymous sign-ins enabled**: Dashboard → Authentication → Settings → Enable anonymous sign-ins
2. **RLS policies for anonymous users**: Policies must allow `auth.uid()` even for anonymous users
3. **Edge Functions deployed**: All `vault-*` edge functions must be deployed
4. **Storage bucket**: The `abba-vault` bucket must exist with appropriate policies

## Manual Override

Users can still manually configure a different Vault backend:

1. Go to Settings → Vault Configuration
2. Enter custom Supabase URL and anon key
3. Save settings

Manual configuration takes precedence over environment defaults.

## Diagnostics

The diagnostics output (Settings → Vault → Copy Diagnostics) now includes:

- `isAnonymous`: Whether the current session is anonymous
- `userId`: The Supabase user ID (exists even for anonymous users)
- `autoConfigAvailable`: Whether environment defaults are available

## Security Considerations

1. **Anon key is safe for clients**: The anon key is designed for client-side use with RLS
2. **Service role key is NEVER embedded**: Build-time secrets only include the anon key
3. **Tokens are encrypted locally**: Using Electron's safeStorage API
4. **Anonymous users have limited permissions**: RLS policies control what anonymous users can do

## Troubleshooting

### "Anonymous sign-in not supported"

Enable anonymous sign-ins in your Supabase project:
Dashboard → Authentication → Settings → Enable anonymous sign-ins

### "fetch failed" in packaged builds

1. Check internet connectivity
2. Verify the Supabase URL is correct
3. Check if a firewall/proxy is blocking connections to `*.supabase.co`

### Session keeps expiring

Anonymous sessions have a 1-hour default expiry. The app should auto-refresh, but if issues persist:

1. Go to Settings → Vault
2. Click "Test Connection" to force a session refresh
3. Or sign in with email/password for a longer-lived session

## Related Files

- `src/vault/vault_config.ts` - Configuration and defaults
- `src/ipc/handlers/vault_handlers.ts` - IPC handlers including anonymous auth
- `.github/workflows/release.yml` - Build-time env var injection
- `scripts/verify-vault-config.mjs` - CI verification script
