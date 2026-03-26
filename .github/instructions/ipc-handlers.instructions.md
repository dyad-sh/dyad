---
description: "Use when editing or creating IPC handler files. Enforces throw-on-error pattern, registration checklist, and channel naming conventions for Electron IPC handlers."
applyTo: "src/ipc/handlers/**"
---

# IPC Handler Guidelines

## Handler Structure

Every handler file MUST:

1. Export a single `register<Domain>Handlers()` function.
2. Use `ipcMain.handle(channelName, async handler)` for each channel.
3. Type all parameters explicitly (e.g., `async (_, params: MyParams) => { ... }`).
4. Return typed results — avoid returning raw untyped objects.

```typescript
import { ipcMain } from "electron";

export function registerExampleHandlers() {
  ipcMain.handle("example:get-items", async (_, params: GetItemsParams) => {
    // ... logic
    return items;
  });
}
```

## Error Handling

- **THROW errors** — never return `{ success: false }` or error-code payloads.
- Let exceptions propagate naturally to the renderer where TanStack Query handles them.
- Use descriptive messages: `throw new Error(\`Chat not found: \${chatId}\`)`.

```typescript
// CORRECT
if (!record) {
  throw new Error(`Record not found: ${id}`);
}

// WRONG — do not do this
if (!record) {
  return { success: false, error: "not found" };
}
```

## Registration Checklist

When adding a new IPC channel, complete ALL of these steps:

1. **Handler**: Add `ipcMain.handle("channel:name", ...)` in the appropriate handler file under `src/ipc/handlers/`.
2. **Host registration**: Import and call `register<Domain>Handlers()` in `src/ipc/ipc_host.ts` inside `registerIpcHandlers()`.
3. **Preload allowlist**: Add `"channel:name"` to `validInvokeChannels` in `src/preload.ts`.
4. **Client method**: Add a typed public method to `src/ipc/ipc_client.ts` (or a domain-specific client) that calls `this.ipcRenderer.invoke("channel:name", params)`.
5. **React hook**: Wrap reads in `useQuery` and writes in `useMutation` with proper `queryKey`, invalidation, and toast error handling.

## Channel Naming

- Use `domain:action` format: `chat:stream`, `settings:get`, `agent:export`.
- Keep names lowercase with hyphens for multi-word segments: `data-vault:get-entries`.
- Match the client method name to the channel semantics.

## Security

- Never use the `remote` module.
- Validate inputs at the handler boundary — don't trust renderer data blindly.
- Lock mutations by `appId` when operating on shared resources.
