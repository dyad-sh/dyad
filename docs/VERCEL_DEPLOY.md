# Vercel Deploy

This document describes how to deploy your ABBA AI apps directly to Vercel.

## Overview

ABBA AI supports direct deployment to Vercel without requiring a GitHub repository. This means you can deploy your app immediately after building it, without needing to set up Git or push to GitHub first.

## Creating a Vercel Access Token

1. Go to [Vercel Account Settings](https://vercel.com/account/tokens)
2. Click "Create Token"
3. Configure the token:
   - **Name**: Give it a descriptive name (e.g., "ABBA AI Deploy")
   - **Scope**: Select "Full Account" for full deployment capabilities
   - **Expiration**: Choose based on your preference (no expiration recommended for development)
4. Click "Create"
5. **Important**: Copy the token immediately! It won't be shown again.

### Required Permissions

The access token needs the following permissions:
- **Deployments**: Create and manage deployments
- **Projects**: Read project information

With "Full Account" scope, you'll have all necessary permissions.

## Connecting ABBA AI to Vercel

1. Open ABBA AI
2. Go to **Settings → Integrations**
3. Find the **Vercel Integration** section
4. Paste your access token
5. Click **Save Token**
6. Click **Test Connection** to verify it works

### Connection Status

After connecting, you'll see:
- Your Vercel username
- Options to test connection or copy diagnostics
- A disconnect button if you need to remove the connection

## Deploying Your App

### Quick Deploy (No GitHub Required)

1. Open your app in ABBA AI
2. Go to the **Publish** tab
3. Click **Deploy to Vercel**
4. Wait for the deployment to complete
5. Click the URL to view your live app

### Deployment Process

The deployment process:
1. **Build**: Runs `npm run build` if no build output exists
2. **Upload**: Uploads all files from your `dist`, `build`, `out`, or `.next` directory
3. **Deploy**: Creates a deployment on Vercel
4. **Ready**: Returns a live URL when complete

### GitHub-Linked Deployments (Optional)

If you also have GitHub connected, you can optionally link your Vercel project to your GitHub repository for automatic deployments on push.

## Troubleshooting

### "Not authenticated with Vercel"

**Problem**: The token is missing or invalid.

**Solution**:
1. Go to Settings → Integrations
2. Check if Vercel is connected
3. If not, add your access token
4. If connected, click "Test Connection" to verify

### "Build failed"

**Problem**: Your app couldn't be built.

**Solution**:
1. Check if your app has a `build` script in `package.json`
2. Try running `npm run build` manually in your terminal
3. Fix any build errors before deploying

### "No output directory found"

**Problem**: The build completed but no deployable files were found.

**Solution**:
1. Ensure your build creates one of: `dist`, `build`, `out`, or `.next`
2. Check your build configuration (e.g., `vite.config.ts` or `next.config.js`)

### "Rate limit exceeded"

**Problem**: Too many deployment requests.

**Solution**:
1. Wait a few minutes before trying again
2. Check your Vercel plan limits at [vercel.com/dashboard](https://vercel.com/dashboard)

### "Deployment failed with status: ERROR"

**Problem**: Vercel encountered an error during deployment.

**Solution**:
1. Check the error message for details
2. Verify your app's build output is valid
3. Check Vercel's status page for any ongoing issues

## Diagnostics

If you need help debugging, use the **Copy Diagnostics** button in Settings → Integrations. This copies safe diagnostic information (no secrets) that you can share when asking for help.

The diagnostics include:
- Connection status
- Whether a token is set (not the actual token)
- Last test result

## Security

- Your access token is stored securely using your operating system's encryption (Electron safeStorage)
- Tokens are never logged or displayed in full
- Diagnostics only show masked token previews (e.g., `***...xxxx`)

## Framework Support

ABBA AI automatically detects your framework and configures Vercel accordingly:

| Framework | Detection |
|-----------|-----------|
| Next.js | `next.config.js/mjs/ts` |
| Vite | `vite.config.js/ts/mjs` |
| Nuxt | `nuxt.config.js/ts` |
| Astro | `astro.config.js/mjs/ts` |
| Svelte | `svelte.config.js` |
| Create React App | `react-scripts` dependency |
| Gatsby | `gatsby` dependency |

## Environment Variables

If your app requires environment variables:
1. Set them in your Vercel project settings at [vercel.com/dashboard](https://vercel.com/dashboard)
2. Or use the `.env.local` file locally (won't be deployed)

## Additional Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Vercel CLI Reference](https://vercel.com/docs/cli)
- [Vercel Limits](https://vercel.com/docs/concepts/limits/overview)
