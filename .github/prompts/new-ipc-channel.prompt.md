---
description: "Scaffold a new IPC channel end-to-end: handler, host registration, preload allowlist, client method, and React hook."
agent: "joycreate-dev"
argument-hint: "channel name and description, e.g. 'data-vault:export — exports vault entries to JSON'"
---

Create a new IPC channel with all required layers. Follow this checklist exactly:

## Inputs

- **Channel name**: Use `domain:action` format (e.g., `data-vault:export`)
- **Purpose**: What this channel does
- **Parameters**: The typed input the handler expects
- **Return type**: What the handler returns

## Steps

### 1. Handler (`src/ipc/handlers/`)

Create or update the handler file for this domain. Follow this pattern:

```typescript
import { ipcMain } from "electron";

export function register<Domain>Handlers() {
  ipcMain.handle("<channel:name>", async (_, params: <ParamsType>) => {
    // Implementation
    // Throw on errors — never return { success: false }
    return result;
  });
}
```

### 2. Host Registration (`src/ipc/ipc_host.ts`)

Import and call the register function inside `registerIpcHandlers()`:

```typescript
import { register<Domain>Handlers } from "./handlers/<domain>_handlers";
// ...
register<Domain>Handlers();
```

### 3. Preload Allowlist (`src/preload.ts`)

Add the channel string to `validInvokeChannels`:

```typescript
const validInvokeChannels = [
  // ...existing channels
  "<channel:name>",
];
```

### 4. Client Method (`src/ipc/ipc_client.ts`)

Add a typed public method:

```typescript
public async <methodName>(params: <ParamsType>): Promise<<ReturnType>> {
  return this.ipcRenderer.invoke("<channel:name>", params);
}
```

### 5. React Hook (`src/hooks/`)

For reads — wrap in `useQuery`:

```typescript
export function use<Feature>() {
  return useQuery({
    queryKey: ["<domain>", "<action>"],
    queryFn: () => IpcClient.getInstance().<methodName>(params),
  });
}
```

For writes — wrap in `useMutation`:

```typescript
export function use<Action>() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: <ParamsType>) => IpcClient.getInstance().<methodName>(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["<domain>"] });
      toast.success("<Success message>");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
```

## Validation

After scaffolding, verify:
- [ ] Channel string matches across handler, preload, and client
- [ ] Handler throws on errors (no `{ success: false }`)
- [ ] Types are consistent end-to-end
- [ ] React hook invalidates related queries on mutation success
