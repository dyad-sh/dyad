# IPC API Documentation

This document describes the Inter-Process Communication (IPC) API used in Dyad for communication between the main process and renderer process.

## Overview

Dyad uses Electron's IPC mechanism with a security-first approach:
- **Whitelist-based**: Only 141 explicitly defined channels are allowed
- **Type-safe**: TypeScript interfaces ensure type safety
- **Centralized**: All handlers are registered through a single entry point
- **Logged**: All IPC calls are logged for debugging

## Architecture

```
Renderer Process (React UI)
    ↓
IPC Client (src/ipc/ipc_client.ts)
    ↓
Preload Script (src/preload.ts) [Security Boundary]
    ↓
IPC Handlers (src/ipc/handlers/*)
    ↓
Business Logic & Database
```

## Using IPC

### From the Renderer Process

```typescript
import { IpcClient } from "@/ipc/ipc_client";

const client = IpcClient.getInstance();

// Example: Get all apps
const apps = await client.getApps();

// Example: Create a new app
const newApp = await client.createApp({
  name: "My App",
  path: "/path/to/app"
});
```

### Handler Categories

IPC handlers are organized by feature:

#### App Handlers (`app_handlers.ts`)
- `getApps` - Retrieve all apps
- `getApp` - Get a single app by ID
- `createApp` - Create a new app
- `deleteApp` - Delete an app
- `updateApp` - Update app details
- `runApp` - Start app development server
- `stopApp` - Stop app development server
- `setFavoriteApp` - Toggle favorite status

#### Chat Handlers (`chat_handlers.ts`)
- `getChats` - Get all chats for an app
- `createChat` - Create a new chat
- `deleteChat` - Delete a chat
- `updateChatTitle` - Update chat title

#### Message Handlers
- `getMessages` - Get messages for a chat
- `sendMessage` - Send a message to AI
- `approveMessage` - Approve AI changes
- `rejectMessage` - Reject AI changes

#### GitHub Handlers (`github_handlers.ts`)
- `initiateGitHubDeviceFlow` - Start GitHub OAuth
- `pollGitHubDeviceFlow` - Check OAuth status
- `getGitHubUser` - Get authenticated user
- `createGitHubRepo` - Create a repository
- `pushToGitHub` - Push code to GitHub
- `cloneRepo` - Clone a repository

#### Vercel Handlers (`vercel_handlers.ts`)
- `initiateVercelAuth` - Start Vercel OAuth
- `getVercelUser` - Get authenticated user
- `deployToVercel` - Deploy to Vercel
- `getVercelDeployments` - List deployments

#### Supabase Handlers (`supabase_handlers.ts`)
- `initiateSupabaseAuth` - Start Supabase OAuth
- `getSupabaseProjects` - List projects
- `executeSupabaseSql` - Run SQL queries
- `deploySupabaseFunction` - Deploy edge function
- `getSupabaseContext` - Get project context

#### Neon Handlers (`neon_handlers.ts`)
- `initiateNeonAuth` - Start Neon OAuth
- `getNeonProjects` - List projects
- `createNeonBranch` - Create database branch
- `getNeonConnectionString` - Get connection string

#### Settings Handlers (`settings_handlers.ts`)
- `getSettings` - Get all settings
- `updateSettings` - Update settings
- `resetSettings` - Reset to defaults

#### MCP Handlers (`mcp_handlers.ts`)
- `getMcpServers` - List MCP servers
- `addMcpServer` - Add new MCP server
- `updateMcpServer` - Update MCP server
- `deleteMcpServer` - Delete MCP server
- `getMcpTools` - Get available tools
- `invokeMcpTool` - Execute MCP tool

## Security Model

### Preload Script Whitelist

All IPC channels must be explicitly whitelisted in `src/preload.ts`:

```typescript
const validInvokeChannels = [
  "get-apps",
  "create-app",
  // ... 139 more channels
];
```

### Safe Handler Wrapper

All handlers use a safe wrapper (`safe_handle.ts`) that:
- Catches and logs errors
- Validates test-only handlers
- Provides consistent error handling

```typescript
export function safeHandle<T>(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<T>
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      logger.log(`[${channel}] Request:`, args);
      const result = await fn(event, ...args);
      logger.log(`[${channel}] Response:`, result);
      return result;
    } catch (error) {
      logger.error(`[${channel}] Error:`, error);
      throw error;
    }
  });
}
```

### Adding New Handlers

To add a new IPC handler:

1. **Create handler function** in appropriate handler file:

```typescript
export function registerMyHandlers() {
  safeHandle("my-new-channel", async (event, param1, param2) => {
    // Your logic here
    return result;
  });
}
```

2. **Add to whitelist** in `src/preload.ts`:

```typescript
const validInvokeChannels = [
  // ... existing channels
  "my-new-channel",
];
```

3. **Register in ipc_host.ts**:

```typescript
import { registerMyHandlers } from "./handlers/my_handlers";

const handlerRegistrations = [
  // ... existing registrations
  registerMyHandlers,
];
```

4. **Add TypeScript types** in `src/ipc/ipc_types.ts`:

```typescript
export interface MyParams {
  param1: string;
  param2: number;
}

export interface MyReturnType {
  success: boolean;
  data: any;
}
```

5. **Update IPC client** in `src/ipc/ipc_client.ts`:

```typescript
async myNewMethod(params: MyParams): Promise<MyReturnType> {
  return this.invoke("my-new-channel", params);
}
```

## Error Handling

IPC handlers should throw errors that will be caught and logged:

```typescript
safeHandle("my-channel", async (event, id) => {
  if (!id) {
    throw new Error("ID is required");
  }

  const result = await database.query(id);

  if (!result) {
    throw new Error(`Not found: ${id}`);
  }

  return result;
});
```

Errors are automatically:
- Logged to `electron-log`
- Sent to error tracking (if configured)
- Returned to renderer with stack trace

## Performance Considerations

### Async Operations

All IPC handlers should be async and non-blocking:

```typescript
// Good - Non-blocking
safeHandle("read-file", async (event, path) => {
  return await fs.promises.readFile(path, "utf-8");
});

// Bad - Blocking
safeHandle("read-file", async (event, path) => {
  return fs.readFileSync(path, "utf-8"); // Blocks main process!
});
```

### Large Data Transfer

For large data transfers, consider:
- Pagination
- Streaming
- Compression
- Chunking

```typescript
// Example: Paginated response
safeHandle("get-messages", async (event, { chatId, offset, limit }) => {
  return await db.query.messages.findMany({
    where: eq(messages.chatId, chatId),
    limit: limit || 50,
    offset: offset || 0,
  });
});
```

## Testing

### Unit Testing IPC Handlers

```typescript
import { registerMyHandlers } from "./my_handlers";
import { ipcMain } from "electron";

describe("My Handlers", () => {
  beforeAll(() => {
    registerMyHandlers();
  });

  it("should handle my-channel", async () => {
    const result = await ipcMain.emit("my-channel", {}, "param");
    expect(result).toBe(expected);
  });
});
```

### E2E Testing

Use Playwright with `electronAPI`:

```typescript
await window.electronAPI.invoke("my-channel", params);
```

## Debugging

### Enable IPC Logging

IPC calls are automatically logged. View logs at:
- macOS: `~/Library/Logs/dyad/main.log`
- Linux: `~/.config/dyad/logs/main.log`
- Windows: `%APPDATA%\dyad\logs\main.log`

### Debug Specific Handlers

Set environment variable:

```bash
DEBUG=dyad:ipc:* npm start
```

### Monitor IPC Traffic

Use Electron DevTools:
1. View → Toggle Developer Tools
2. Console tab → Filter by "IPC"

## Best Practices

1. **Always use type-safe interfaces**
2. **Validate input parameters**
3. **Use async/await for all I/O**
4. **Handle errors explicitly**
5. **Log important operations**
6. **Keep handlers focused and small**
7. **Use transactions for database operations**
8. **Never expose file system directly**
9. **Sanitize all paths (use `safeJoin`)**
10. **Test both success and error cases**

## Security Checklist

- [ ] Handler is whitelisted in preload script
- [ ] Input parameters are validated
- [ ] File paths use `safeJoin` utility
- [ ] No user input is executed as code
- [ ] Sensitive data is not logged
- [ ] Error messages don't leak internals
- [ ] Rate limiting for expensive operations
- [ ] Authentication checked where needed

## Related Documentation

- [Architecture](./architecture.md)
- [Security](../SECURITY.md)
- [Contributing](../CONTRIBUTING.md)
- [Troubleshooting](./TROUBLESHOOTING.md)
