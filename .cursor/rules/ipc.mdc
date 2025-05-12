---
description: 
globs: 
alwaysApply: true
---
You're building an Electron app following good security practices

# IPC
Structure:
- [ipc_client.ts](mdc:src/ipc/ipc_client.ts) - lives in the renderer process and is used to send IPCs to the main process.
    - to use it just do `IpcClient.getInstance()`
- [preload.ts](mdc:src/preload.ts) - allowlist
- [ipc_host.ts](mdc:src/ipc/ipc_host.ts) - contains the various IPC handlers attached which are: [app_handlers.ts](mdc:src/ipc/handlers/app_handlers.ts), [chat_stream_handlers.ts](mdc:src/ipc/handlers/chat_stream_handlers.ts), [settings_handlers.ts](mdc:src/ipc/handlers/settings_handlers.ts) etc.

# React
- This is a React app
- Using TanStack router, NOT next.js, NOT react Router.


# IPC & React query patterns


Okay, I can help you summarize this pattern for creating a new Cursor rule, focusing on the TanStack Query integration and the preferred error handling strategy.

Here's a summary of the pattern:

The pattern involves a client-side React hook interacting with main process IPC handlers via an `IpcClient` layer, leveraging TanStack Query for managing asynchronous operations, state, and caching.

**1. React Hook (e.g., `useSomething.ts`):**

*   **Data Fetching (`useQuery`):**
    *   Define a `queryKey` (e.g., `["entity", entityId]`) for caching and invalidation.
    *   The `queryFn` is an asynchronous function that:
        *   Retrieves an `IpcClient` instance.
        *   Calls the appropriate method on `IpcClient` (e.g., `ipcClient.listEntities({ parentId })`). This method corresponds to an IPC channel.
    *   Use the `enabled` option if the query depends on certain conditions (e.g., `entityId !== null`).
    *   Optionally provide `initialData` and `meta` (e.g., for global error display like `showErrorToast: true`).
    *   The hook returns `data`, `isLoading`, `error`, and a `refetch` function from `useQuery`.

*   **Data Mutations (`useMutation`):**
    *   The `mutationFn` is an asynchronous function that:
        *   Performs any necessary input validation, potentially throwing an error directly if client-side checks fail (e.g., `if (!entityId) throw new Error("Entity ID is required");`).
        *   Retrieves an `IpcClient` instance.
        *   Calls the appropriate method on `IpcClient` (e.g., `ipcClient.createEntity({ data })`).
    *   `onSuccess`:
        *   Invalidate relevant queries using `queryClient.invalidateQueries({ queryKey: ["entity"] })` to ensure data consistency and trigger refetches.
        *   Optionally, update local state directly or refetch specific related data.
    *   `onError`:
        *   Handle errors, often by displaying a notification to the user (e.g., using a `showError(error)` utility).
    *   The hook exposes an asynchronous function (e.g., `createEntity`) that internally calls `mutation.mutateAsync(params)`.

*   **Local State Management (Optional, e.g., Jotai):**
    *   `useEffect` can synchronize data fetched by TanStack Query with global state atoms if needed.
    *   Atoms can also store UI-related state or parameters for hooks.

**2. IPC Client (`ipc_client.ts`):**

*   Acts as an intermediary between the renderer process (React hooks) and the main process (IPC handlers).
*   For each IPC channel, it has a corresponding asynchronous method (e.g., `async listEntities(params) { return this.ipcRenderer.invoke("list-entities", params); }`).
*   It uses `ipcRenderer.invoke` to send messages and receive `Promise`s. If the main process handler throws an error, the `Promise` will be rejected, and this rejection will be handled by TanStack Query in the hook.

**3. IPC Handlers (e.g., `entity_handlers.ts` in the main process):**

*   **Registration:**
    *   Handlers are registered using `ipcMain.handle("channel-name", async (event, args) => { /* ... */ })`. The `channel-name` must match what `IpcClient` calls.
*   **Logic:**
    *   Contains the core business logic, interacting with databases (e.g., `db`), file system (`fs`), or other main-process services (e.g., `git`).
*   **Error Handling (Crucial):**
    *   **Handlers MUST `throw new Error("Descriptive error message")` when an operation fails or an invalid state is encountered.** This is the preferred pattern over returning objects like `{ success: false, errorMessage: "..." }`.
    
*   **Concurrency (If Applicable):**
    *   For operations that modify shared resources related to a specific entity (like an `appId`), use a locking mechanism (e.g., `withLock(appId, async () => { ... })`) to prevent race conditions.

**Flow Summary:**

1.  React component calls a function from the custom hook.
2.  The hook's `queryFn` (for reads) or `mutationFn` (for writes) calls a method on `IpcClient`.
3.  `IpcClient` uses `ipcRenderer.invoke` to send a message to the main process.
4.  The corresponding `ipcMain.handle` in the main process executes.
    *   If successful, it returns data.
    *   **If an error occurs, it `throw`s an `Error`.**
5.  The `Promise` from `ipcRenderer.invoke` resolves or rejects.
6.  TanStack Query handles the resolved data or the rejection:
    *   `useQuery`: Populates `data` or `error`.
    *   `useMutation`: Calls `onSuccess` or `onError`.

This pattern ensures that errors are propagated correctly from the main process back to the React application, where TanStack Query can manage the error state and allow for robust error handling and UI feedback.
