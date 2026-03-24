/**
 * ProteaAI Web Entry Point
 *
 * This replaces renderer.tsx when building the web (non-Electron) version.
 * It injects the web IPC adapter BEFORE the React app so that all IPC calls
 * are routed over HTTP/WebSocket instead of Electron's IPC bridge.
 */

// 1. Inject the web IPC adapter (sets window.electron shim)
import "./web-ipc-adapter";

// 2. Boot the rest of the app (same as renderer.tsx)
import "../renderer";
