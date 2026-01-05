# Cloudflare Pages Extension

This extension allows users to deploy their Dyad applications to Cloudflare Pages.

## Features

- **Authenticate with Cloudflare**: Securely store Cloudflare API tokens
- **Create Projects**: Create new Cloudflare Pages projects
- **Connect Existing Projects**: Link to existing Cloudflare Pages projects
- **View Deployments**: List and view deployment history
- **Disconnect Projects**: Remove project connections

## Setup

### 1. Get Cloudflare API Token

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. Click "Create Token"
3. Use the "Edit Cloudflare Workers" template or create a custom token with:
   - Account: `Cloudflare Pages:Edit` permission
   - Zone Resources: Include all zones (or specific zones)
4. Copy the generated token

### 2. Configure Extension

1. Open Dyad Settings
2. Navigate to the Cloudflare Pages section
3. Enter your API token
4. Click "Save Access Token"

### 3. Connect a Project

1. Open your app in Dyad
2. Navigate to the Cloudflare Pages connector
3. Choose to either:
   - **Create a new project**: Enter a project name
   - **Connect to existing project**: Select from your existing projects
4. Click the appropriate button to connect

## API Reference

### IPC Channels

All channels are namespaced with `extension:cloudflare:`:

- `extension:cloudflare:save-token` - Save Cloudflare API token
- `extension:cloudflare:list-projects` - List all Cloudflare Pages projects
- `extension:cloudflare:create-project` - Create a new Cloudflare Pages project
- `extension:cloudflare:connect-existing-project` - Connect to an existing project
- `extension:cloudflare:list-deployments` - Get deployments for a project
- `extension:cloudflare:disconnect` - Disconnect a project

### Extension Data Storage

The extension stores the following data per app:

- `projectId` - Cloudflare Pages project ID
- `projectName` - Project name
- `accountId` - Cloudflare account ID
- `deploymentUrl` - Primary deployment URL

## Development

### File Structure

```
cloudflare/
  ├── manifest.json      # Extension manifest
  ├── main.ts           # Main process entry point
  ├── handlers.ts       # IPC handlers
  ├── types.ts          # TypeScript types
  ├── hooks.ts          # React hooks (for renderer)
  └── README.md         # This file
```

### Building

Extensions are loaded from the `extensions/plugins/` directory. The extension manager will automatically discover and load this extension on app startup.

## Notes

- The extension requires a valid Cloudflare API token with appropriate permissions
- Projects are stored per-app in the extension_data table
- Deployment URLs are automatically detected from the project's primary domain
- Build output directories are auto-detected (dist, build, .next, out, public)
