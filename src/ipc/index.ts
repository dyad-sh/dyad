/**
 * IPC Client Index
 * 
 * Automatically selects the correct IPC client implementation based on environment:
 * - Web mode: Uses REST/WebSocket API adapter
 * - Electron mode: Uses native IPC
 */

// Check if running in web mode (no Electron)
const isWebMode = !!(
    typeof window !== "undefined" &&
    (import.meta.env.VITE_WEB_MODE || !("electron" in window))
);

// Dynamic import based on environment
export async function getIpcClient() {
    if (isWebMode) {
        const { IpcClient } = await import("./ipc_web_adapter");
        return IpcClient.getInstance();
    } else {
        const { IpcClient } = await import("./ipc_client");
        return IpcClient.getInstance();
    }
}

// Re-export types
export type { ChatStreamCallbacks, AppStreamCallbacks } from "./ipc_client";

// For synchronous access (assumes Electron mode by default for backwards compatibility)
// In web mode, components should use getIpcClient() instead
export { IpcClient } from "./ipc_client";
