/**
 * ProteaAI Web Server
 *
 * Express server that:
 *  1. Enables web mode on the IPC handler base (so all handlers register via
 *     webHandlerRegistry instead of Electron's ipcMain)
 *  2. Imports all IPC handlers (which self-register into the registry)
 *  3. Exposes each channel as POST /api/:channel  (auth-protected)
 *  4. Attaches a WebSocket server for push events (replacing ipcRenderer.on)
 *  5. Mounts auth, billing, admin, and GDPR route groups
 *  6. Serves the built React SPA from /dist/web
 */

// Must be FIRST — sets web mode before any handler imports
import { enableWebMode, webHandlerRegistry } from "../src/ipc/handlers/base";
enableWebMode();

import express from "express";
import { createServer } from "http";
import path from "node:path";
import fs from "node:fs";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { wsManager } from "./ws_manager";
import { setWebBroadcaster } from "../src/ipc/utils/safe_sender";
import { safeRoute } from "./middleware/safe_route";
import { requireAuth } from "./middleware/auth";
import { authRouter } from "./routes/auth";
import { billingRouter } from "./routes/billing";
import { adminRouter } from "./routes/admin";
import { gdprRouter } from "./routes/gdpr";
import dotenv from "dotenv";

// Load env vars
dotenv.config();

import { getProteaAIAppPath } from "../src/paths/paths";
import { getMimeType } from "../src/ipc/utils/mime_utils";
import { PROTEAAI_MEDIA_DIR_NAME } from "../src/ipc/utils/media_path_utils";
import { db } from "../src/db";
import { apps } from "../src/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "../src/ipc/context/user-context";

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

// CORS
const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim());
app.use(cors({ origin: allowedOrigins, credentials: true }));

// Raw body for Stripe webhooks (must be before express.json)
app.use(
  "/billing/webhook",
  express.raw({ type: "application/json" }),
);

app.use(express.json({ limit: "50mb" }));

// ── Rate limiting ─────────────────────────────────────────────────────────────

// Global limiter: 300 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests, please slow down." },
});

// Strict limiter for auth endpoints: 10 attempts per 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many auth attempts, please try again later." },
});

app.use(globalLimiter);

// ── Health check (public) ─────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ ok: true, version: process.env.npm_package_version ?? "1.0.0" });
});

// ── Auth routes (public) ──────────────────────────────────────────────────────

app.use("/auth", authLimiter, authRouter);

// ── Billing routes (auth-protected) ──────────────────────────────────────────

app.use("/billing", billingRouter);

// ── Admin routes (admin-only) ─────────────────────────────────────────────────

app.use("/admin", adminRouter);

// ── GDPR routes (auth-protected) ─────────────────────────────────────────────

app.use("/gdpr", gdprRouter);

// ── IPC → HTTP bridge (auth-protected) ───────────────────────────────────────

/**
 * POST /api/:channel
 *
 * Requires a valid JWT. The auth middleware sets the user context so IPC
 * handlers can call getCurrentUser() / requireCurrentUser().
 *
 * Body: the input payload for the IPC channel.
 * Response: { ok: true, data: <result> } | { ok: false, error: string }
 */
app.post(
  "/api/:channel(*)",
  requireAuth,
  safeRoute("ipc-bridge", async (req) => {
    const channel = req.params.channel;
    const handler = webHandlerRegistry.get(channel);
    if (!handler) {
      throw new Error(`Unknown channel: ${channel}`);
    }
    return handler(req.body);
  }),
);

// ── Media file serving (auth-protected) ──────────────────────────────────────

/**
 * GET /media/:encodedAppPath/:encodedFilename
 *
 * Serves persistent media files stored on disk.
 * Mirrors the proteaai-media:// Electron protocol handler with the same
 * security checks (path traversal prevention, directory confinement).
 */
app.get("/media/:encodedAppPath/:encodedFilename", requireAuth, async (req, res) => {
  const encodedAppPath = req.params.encodedAppPath;
  const encodedFilename = req.params.encodedFilename;

  let appPathRaw: string;
  let filename: string;
  try {
    appPathRaw = decodeURIComponent(encodedAppPath);
    filename = decodeURIComponent(encodedFilename);
  } catch {
    res.status(400).send("Bad Request");
    return;
  }

  // Reject filenames with path separators or traversal
  if (
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\")
  ) {
    res.status(403).send("Forbidden");
    return;
  }

  // Verify the requesting user owns the app this media belongs to
  const currentUser = getCurrentUser();
  if (currentUser) {
    const ownedApp = await db.query.apps.findFirst({
      where: and(eq(apps.path, appPathRaw), eq(apps.userId, currentUser.userId)),
    });
    if (!ownedApp) {
      res.status(403).send("Forbidden");
      return;
    }
  }

  const appPath = getProteaAIAppPath(appPathRaw);
  const mediaDir = path.resolve(path.join(appPath, PROTEAAI_MEDIA_DIR_NAME));
  const resolvedPath = path.resolve(path.join(mediaDir, filename));

  // Security: ensure the resolved path stays within the app's media directory
  if (!resolvedPath.startsWith(mediaDir + path.sep) && resolvedPath !== mediaDir) {
    res.status(403).send("Forbidden");
    return;
  }

  if (!fs.existsSync(resolvedPath)) {
    res.status(404).send("Not Found");
    return;
  }

  const ext = path.extname(filename).toLowerCase();
  const mimeType = getMimeType(ext);
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  fs.createReadStream(resolvedPath).pipe(res);
});

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
setWebBroadcaster((channel, payload) => wsManager.broadcast(channel, payload));

httpServer.listen(PORT, () => {
  console.log(`ProteaAI web server running on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`Registered IPC channels: ${webHandlerRegistry.size}`);
});
