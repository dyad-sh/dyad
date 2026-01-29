# GitHub OAuth Configuration

This document describes how to set up GitHub OAuth integration for ABBA AI.

## Overview

ABBA AI uses GitHub's Device Flow for OAuth authentication. This allows users to:

- Connect their GitHub account
- Create new repositories
- Push code to repositories

## Creating a GitHub OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click "New OAuth App" (or "Register a new application")
3. Fill in the application details:
   - **Application name**: `ABBA AI` (or your custom name)
   - **Homepage URL**: Your app's homepage (e.g., `https://github.com/yosiwizman/dyad`)
   - **Authorization callback URL**: Not used for Device Flow, but required. Use `https://github.com`
4. Click "Register application"
5. On the app page, click "Generate a new client secret" (note: we don't use the secret for Device Flow)
6. **Important**: Enable Device Flow:
   - Scroll down to "Device Flow"
   - Check "Enable Device Flow"
   - Save changes
7. Copy the **Client ID** (you don't need the secret for Device Flow)

## Environment Variables

### Production Builds

Set the following environment variable:

```bash
# Preferred variable for ABBA-branded builds
ABBA_GITHUB_OAUTH_CLIENT_ID=your_client_id_here
```

### Development

For local development, create a `.env` file (copy from `.env.example`):

```bash
cp .env.example .env
```

Then add your client ID:

```bash
ABBA_GITHUB_OAUTH_CLIENT_ID=your_client_id_here
```

### CI/Release Builds

Add `ABBA_GITHUB_OAUTH_CLIENT_ID` as a repository secret in GitHub Actions:

1. Go to your repository → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `ABBA_GITHUB_OAUTH_CLIENT_ID`
4. Value: Your OAuth App's Client ID

## OAuth Scopes

ABBA AI requests the following minimal scopes:

| Scope        | Purpose                                     |
| ------------ | ------------------------------------------- |
| `read:user`  | Get authenticated user's login (username)   |
| `user:email` | Access user's email for git commits         |
| `repo`       | Create repos, push code, read private repos |

### Scopes NOT Requested

The following scopes are intentionally not requested to minimize permissions:

- `workflow` - Not needed unless users want to manage GitHub Actions
- `admin` - No admin operations needed
- `delete_repo` - Users should delete repos via GitHub web UI
- `write:org` - No organization-level operations needed

## Device Flow

ABBA AI uses [GitHub's Device Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow) which:

1. Does NOT require a client secret (important for desktop apps)
2. Shows a user-friendly code-entry page
3. Works without a redirect URL

The flow:

1. User clicks "Connect to GitHub"
2. App requests a device code from GitHub
3. User is shown a verification URL and code
4. User enters the code at `https://github.com/login/device`
5. App polls GitHub until authorization is complete
6. Access token is stored securely in settings

## Security Considerations

### No Client Secret in App

The client secret is NEVER embedded in the desktop app. Device Flow only requires the client_id, which is safe to include in client applications.

### Token Storage

Access tokens are stored in the app's settings file. On each platform:

- **macOS**: `~/Library/Application Support/ABBA AI/settings.json`
- **Windows**: `%APPDATA%\ABBA AI\settings.json`
- **Linux**: `~/.config/ABBA AI/settings.json`

### Validation

The app validates OAuth configuration at runtime:

- Rejects missing client_id
- Rejects the legacy Dyad client_id (to prevent accidental use)

## Troubleshooting

### "GitHub integration not configured"

This error appears if `ABBA_GITHUB_OAUTH_CLIENT_ID` is not set. Set the environment variable and rebuild the app.

### Device Flow not working

1. Ensure Device Flow is enabled in your OAuth App settings
2. Verify the client_id is correct
3. Check network connectivity to `github.com`

### "Authorization denied by user"

User clicked "Cancel" on the GitHub authorization page. They need to try again and click "Authorize".

## CI Verification

The `verify-github-oauth-config.mjs` script runs in CI to ensure:

1. Legacy Dyad client_id is not used as a fallback
2. `ABBA_GITHUB_OAUTH_CLIENT_ID` pattern is present
3. OAuth scopes are minimal
4. Validation function is exported

Run locally:

```bash
node scripts/verify-github-oauth-config.mjs
```
