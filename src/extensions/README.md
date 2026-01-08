# Extension System

This directory contains the extension system infrastructure for Dyad.

## Architecture

The extension system allows third-party developers to create extensions that integrate with Dyad's IPC system, database, and UI.

## Core Components

### `core/extension_types.ts`

TypeScript type definitions for extensions, including:

- `ExtensionManifest`: Extension metadata structure
- `ExtensionContext`: Context provided to extensions in main process
- `ExtensionMain`: Main process entry point function type
- `ExtensionRenderer`: Renderer process entry point function type

### `core/extension_registry.ts`

Singleton registry that stores all loaded extensions.

### `core/extension_manager.ts`

Manages the loading and lifecycle of extensions:

- Discovers extensions from the extensions directory
- Validates extension manifests
- Loads and initializes extension main process code
- Provides extension context with IPC handler registration, database access, etc.

### `core/extension_data.ts`

Helper functions for extensions to store and retrieve data:

- `setExtensionData()`: Store extension-specific data for an app
- `getExtensionData()`: Retrieve extension-specific data for an app
- `getAllExtensionData()`: Get all data for an extension and app
- `deleteExtensionData()`: Delete extension data

## Extension Structure

Extensions should be placed in the `extensions/plugins/` directory (relative to dyad-apps directory).

### Extension Directory Structure

```
extensions/plugins/{extension-id}/
  manifest.json       # Extension metadata
  main.ts            # Main process entry point (if hasMainProcess: true)
  renderer.tsx       # Renderer process entry point (optional)
  ...                # Other extension files
```

### Manifest Format

```json
{
  "id": "extension-id",
  "name": "Extension Name",
  "version": "1.0.0",
  "description": "Extension description",
  "author": "Author Name",
  "capabilities": {
    "hasMainProcess": true,
    "hasRendererProcess": false,
    "hasDatabaseSchema": false,
    "hasSettingsSchema": false,
    "ipcChannels": ["channel1", "channel2"]
  },
  "main": "main.js",
  "renderer": "renderer.js",
  "ui": {
    "settingsPage": {
      "component": "SettingsComponent",
      "title": "Extension Settings"
    },
    "appConnector": {
      "component": "ConnectorComponent",
      "title": "Extension Connector"
    }
  }
}
```

## IPC Channel Namespacing

All extension IPC channels must be namespaced with the pattern:

```
extension:{extension-id}:{channel-name}
```

For example, an extension with ID "cloudflare" registering a channel "deploy" would use:

```
extension:cloudflare:deploy
```

## Extension Context API

Extensions receive a context object with the following methods:

### IPC Registration

```typescript
context.registerIpcHandler(
  "extension:myext:my-channel",
  async (event, args) => {
    // Handler implementation
  },
);
```

### Database Access

```typescript
const db = context.getDb();
// Use drizzle ORM to query database
```

### Settings Access

```typescript
const settings = context.readSettings();
context.writeSettings({ ...settings, newField: value });
```

### App Data Access

```typescript
const app = await context.getApp(appId);
await context.updateApp(appId, { name: "New Name" });
```

### Extension Data Storage

```typescript
await context.setExtensionData(appId, "projectId", "proj_123");
const projectId = await context.getExtensionData(appId, "projectId");
const allData = await context.getAllExtensionData(appId);
```

## Database Schema

Extensions can store data using the `extension_data` table:

```sql
CREATE TABLE extension_data (
  id INTEGER PRIMARY KEY,
  app_id INTEGER NOT NULL,
  extension_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,  -- JSON string
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(app_id, extension_id, key),
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);
```

## Settings Schema

Extension settings are stored in `UserSettings.extensionSettings`:

```typescript
extensionSettings?: {
  [extensionId: string]: {
    [key: string]: any;
  };
};
```

## Security Considerations

- All IPC channels are validated and must follow the namespacing pattern
- Extensions run in the main process with full Node.js access (security considerations apply)
- Extension code is not sandboxed (extensions have the same privileges as the main process)
- Extension manifests are validated before loading

## Future Enhancements

- Renderer process extension loading
- Extension sandboxing/isolation
- Extension permissions system
- Extension marketplace
- Extension code signing
- Hot-reloading for development
