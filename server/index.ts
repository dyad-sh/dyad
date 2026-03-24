/**
 * ProteaAI Web Server
 *
 * Express server that:
 *  1. Enables web mode on the IPC handler base (so all handlers register via
 *     webHandlerRegistry instead of Electron's ipcMain)
 *  2. Imports all IPC handlers (which self-register into the registry)
 *  3. Exposes each channel as POST /api/:channel
 *  4. Attaches a WebSocket server for push events (replacing ipcRenderer.on)
 *  5. Serves the built React SPA from /dist/web
 */

// Must be FIRST — sets web mode before any handler imports
import { enableWebMode, webHandlerRegistry } from "../src/ipc/handlers/base";
enableWebMode();

import express from "express";
import { createServer } from "http";
import path from "node:path";
import cors from "cors";
import { wsManager } from "./ws_manager";
import { safeRoute } from "./middleware/safe_route";
import dotenv from "dotenv";

// Load env vars
dotenv.config();

// Now import and register all IPC handlers
// (They will self-register into webHandlerRegistry because web mode is enabled)
import { registerIpcHandlers } from "../src/ipc/ipc_host";

// Initialize DB before handlers run
import { initializeDatabase } from "../src/db";
initializeDatabase();

registerIpcHandlers();

// ── Express app ──────────────────────────────────────────────────────────────

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json({ limit: "50mb" }));

// ── IPC → HTTP bridge ────────────────────────────────────────────────────────

/**
 * POST /api/:channel
 *
 * Body: the input payload for the IPC channel.
 * Response: { ok: true, data: <result> } | { ok: false, error: string }
 */
app.post(
  "/api/:channel(*)",
  safeRoute("ipc-bridge", async (req) => {
    const channel = req.params.channel;
    const handler = webHandlerRegistry.get(channel);
    if (!handler) {
      throw new Error(`Unknown channel: ${channel}`);
    }
    return handler(req.body);
  }),
);

// ── Serve built React SPA ────────────────────────────────────────────────────

const webDistPath = path.resolve(__dirname, "../dist/web");
app.use(express.static(webDistPath));
// SPA fallback — serve index.html for all unmatched routes
app.get("*", (_req, res) => {
  res.sendFile(path.join(webDistPath, "index.html"));
});

// ── HTTP + WebSocket server ──────────────────────────────────────────────────

const httpServer = createServer(app);
wsManager.attach(httpServer);

httpServer.listen(PORT, () => {
  console.log(`ProteaAI web server running on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`Registered IPC channels: ${webHandlerRegistry.size}`);
});
