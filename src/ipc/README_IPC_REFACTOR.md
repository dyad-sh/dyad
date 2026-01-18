# Type-Safe IPC Refactor

This directory contains a refactored, type-safe IPC (Inter-Process Communication) architecture for the Dyad application.

## Overview

The new IPC pattern provides:

- **Type Safety**: Compile-time type checking for all IPC calls
- **Modularity**: Centralized type definitions with distributed handler implementations
- **Conciseness**: Reduced boilerplate with automatic logging and error handling
- **Maintainability**: Single source of truth for channel definitions
- **Developer Experience**: Auto-complete and refactoring support

## Architecture

### Core Files

1. **`ipc_registry.ts`** - Central type registry
   - Defines all IPC channels and their request/response types
   - Single source of truth for the IPC contract
   - Provides type utilities for handlers and client

2. **`ipc_handler.ts`** - Type-safe handler utilities
   - `createIpcHandler()` - Register individual handlers
   - `createHandlerFactory()` - Create handler registrar with shared config
   - `createSimpleHandler()` - For handlers that don't need the event parameter
   - Automatic logging, error handling, and type enforcement

3. **`ipc_client_helpers.ts`** - Type-safe client utilities
   - `typedInvoke()` - Type-safe wrapper for `ipcRenderer.invoke()`
   - `createTypedIpcClient()` - Factory for type-safe IPC client
   - `createMockIpcRenderer()` - Testing utilities

4. **`ipc_client.ts`** - Updated IPC client
   - Existing IPC client methods being gradually migrated
   - Examples of type-safe method implementations

## Usage

### Defining a New IPC Channel

1. Add the channel to the registry in `ipc_registry.ts`:

```typescript
export interface IpcChannelRegistry {
  // ... existing channels
  "my-new-channel": {
    params: { userId: number; data: string };
    returns: { success: boolean; message: string };
  };
}
```

2. Add metadata (optional but recommended):

```typescript
export const channelMetadata = {
  // ... existing metadata
  "my-new-channel": {
    description: "My new channel description",
    group: "my-feature",
  },
} as const satisfies Record<IpcChannelName, { description: string; group: string }>;
```

### Creating a Handler

In your handler file (e.g., `handlers/my_feature_handlers.ts`):

```typescript
import { createHandlerFactory } from "../ipc_handler";
import log from "electron-log";

const logger = log.scope("my_feature");
const handle = createHandlerFactory({ logger, logDetails: false });

export function registerMyFeatureHandlers() {
  handle("my-new-channel", async (event, params) => {
    // params is automatically typed as { userId: number; data: string }
    // return type is enforced as { success: boolean; message: string }

    const result = await doSomething(params.userId, params.data);

    return {
      success: true,
      message: "Done!",
    };
  });
}
```

### Using from the Client

In `ipc_client.ts`:

```typescript
import { typedInvoke } from "./ipc_client_helpers";

export class IpcClient {
  // ... existing code

  public async myNewMethod(userId: number, data: string) {
    // Fully type-safe call
    const result = await typedInvoke(
      this.ipcRenderer,
      "my-new-channel",
      { userId, data }
    );
    // result is typed as { success: boolean; message: string }
    return result;
  }
}
```

## Migration Guide

### Migrating Existing Handlers

**Before:**
```typescript
import { createLoggedHandler } from "./safe_handle";

const logger = log.scope("app_handlers");
const handle = createLoggedHandler(logger);

export function registerAppHandlers() {
  handle("get-app", async (_, appId: number): Promise<App> => {
    // Manual type annotations required
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });
    return app;
  });
}
```

**After:**
```typescript
import { createHandlerFactory } from "../ipc_handler";

const logger = log.scope("app_handlers");
const handle = createHandlerFactory({ logger, logDetails: false });

export function registerAppHandlers() {
  // Types automatically inferred from registry
  handle("get-app", async (_, appId) => {
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });
    return app; // Return type automatically checked
  });
}
```

### Migrating Client Methods

**Before:**
```typescript
public async getApp(appId: number): Promise<App> {
  return this.ipcRenderer.invoke("get-app", appId);
  // No type safety - easy to typo channel name or pass wrong params
}
```

**After:**
```typescript
public async getApp(appId: number): Promise<App> {
  return typedInvoke(this.ipcRenderer, "get-app", appId);
  // Compile-time type checking for channel, params, and return type
}
```

## Benefits

### 1. Type Safety

```typescript
// ✅ Correct usage
await typedInvoke(ipcRenderer, "get-app", 123);

// ❌ TypeScript error: wrong param type
await typedInvoke(ipcRenderer, "get-app", "wrong");

// ❌ TypeScript error: channel doesn't exist
await typedInvoke(ipcRenderer, "non-existent-channel", {});
```

### 2. Refactoring Safety

When you rename a channel or change its types:
- Update the registry once
- TypeScript shows all locations that need updating
- No silent runtime failures

### 3. Auto-Complete

Your IDE provides auto-complete for:
- Channel names
- Parameter types
- Return types

### 4. Reduced Boilerplate

**Before:**
```typescript
ipcMain.handle("my-channel", async (event, params) => {
  logger.log(`IPC: my-channel called with args: ${JSON.stringify(params)}`);
  try {
    const result = await doSomething(params);
    logger.log(`IPC: my-channel returned: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    logger.error(`Error in my-channel:`, error);
    throw new Error(`[my-channel] ${error}`);
  }
});
```

**After:**
```typescript
handle("my-channel", async (_, params) => {
  return doSomething(params);
  // Logging and error handling automatic!
});
```

## Testing

Use `createMockIpcRenderer` for unit tests:

```typescript
import { createMockIpcRenderer, createTypedIpcClient } from "./ipc_client_helpers";

const mockIpc = createMockIpcRenderer({
  'get-app': async (appId) => ({
    id: appId,
    name: 'Test App',
    // ... other required fields
  }),
});

const client = createTypedIpcClient(mockIpc);
const app = await client.invoke('get-app', 123); // Fully typed!
```

## Incremental Adoption

You can adopt this pattern incrementally:

1. ✅ Registry and utilities are already set up
2. ✅ Example handlers have been refactored (see `chat_handlers.ts`, parts of `app_handlers.ts`)
3. ✅ Example client methods have been migrated (see `ipc_client.ts`)
4. 🔄 Migrate remaining handlers gradually
5. 🔄 Migrate remaining client methods gradually

Both old and new patterns can coexist during migration.

## Best Practices

1. **Always add new channels to the registry first**
   - This ensures type safety from the start

2. **Use `createHandlerFactory` for consistent logging**
   - Create one factory per handler file with shared logger

3. **Keep handlers focused**
   - Each handler should do one thing well
   - Complex logic should be in separate service functions

4. **Use descriptive channel names**
   - Use kebab-case: `get-user-settings`
   - Be specific: `create-app` not just `create`
   - Group related channels: `github:*`, `vercel:*`

5. **Document complex types**
   - Add JSDoc comments to complex parameter types
   - Link to related types or schemas

## Examples

See these files for complete examples:

- **Handler**: `handlers/chat_handlers.ts` - Fully refactored handlers
- **Client**: `ipc_client.ts` - Migrated client methods (see comments)
- **Types**: `ipc_registry.ts` - Channel definitions

## Future Enhancements

Possible improvements for the future:

1. **Runtime Validation**: Add Zod schemas to registry for runtime param validation
2. **Auto-Generated Client**: Generate client methods from registry
3. **OpenAPI-like Docs**: Auto-generate API documentation from registry
4. **Request/Response Logging**: Configurable logging levels per channel
5. **Performance Metrics**: Track IPC call durations and frequencies

## Questions?

For questions or issues with the new IPC pattern, please refer to:
- This README
- Example code in refactored handlers
- Type definitions in `ipc_registry.ts`
