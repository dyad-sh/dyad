# Repository Agent Guide

## Project context

- This is an Electron application with a secure IPC boundary.
- Frontend is a React app that uses TanStack Router (not Next.js or React Router).
- Data fetching/mutations should be handled with TanStack Query when touching IPC-backed endpoints.

## IPC architecture expectations

1. `src/ipc/ipc_client.ts` runs in the renderer. Access it via `IpcClient.getInstance()` and expose dedicated methods per IPC channel.
2. `src/preload.ts` defines the renderer allowlist. New IPC APIs must be added here.
3. `src/ipc/ipc_host.ts` registers handlers that live in files under `src/ipc/handlers/` (e.g., `app_handlers.ts`, `chat_stream_handlers.ts`, `settings_handlers.ts`).
4. IPC handlers should `throw new Error("...")` on failure instead of returning `{ success: false }` style payloads.

## React + IPC integration pattern

When creating hooks/components that call IPC handlers:

- Wrap reads in `useQuery`, providing a stable `queryKey`, async `queryFn` that calls the relevant `IpcClient` method, and conditionally use `enabled`/`initialData`/`meta` as needed.
- Wrap writes in `useMutation`; validate inputs locally, call the IPC client, and invalidate related queries on success. Use shared utilities (e.g., toast helpers) in `onError`.
- Synchronize TanStack Query data with any global state (like Jotai atoms) via `useEffect` only if required.

## General guidance

- Favor descriptive module/function names that mirror IPC channel semantics.
- Keep Electron security practices in mind (no `remote`, validate/lock by `appId` when mutating shared resources).
- Add tests in the same folder tree when touching renderer components.

Use these guidelines whenever you work within this repository.
