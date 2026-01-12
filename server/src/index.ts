/**
 * Dyad Web Server
 * Main entry point for the Express backend
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";

import { errorHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { initializeDatabase } from "./db/index.js";

// Routes
import healthRoutes from "./routes/health.js";
import appsRoutes from "./routes/apps.js";
import templatesRoutes from "./routes/templates.js";
import chatsRoutes from "./routes/chats.js";
import settingsRoutes from "./routes/settings.js";
import githubRoutes from "./routes/github.js";
import mcpRoutes from "./routes/mcp.js";
import promptsRoutes from "./routes/prompts.js";
import providersRoutes from "./routes/providers.js";
import chatSSERoutes from "./routes/chatSSE.js";
import { setupChatWebSocket } from "./routes/chatStream.js";
import { setupTerminalWebSocket } from "./routes/terminal.js";

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3007;
const HOST = process.env.HOST || "0.0.0.0";

async function main() {
    // Initialize database
    console.log("Initializing database...");
    await initializeDatabase();

    // Create Express app
    const app = express();
    const server = createServer(app);

    // DEBUG: Log ALL incoming requests immediately
    app.use((req, res, next) => {
        console.log(`[Edge] Incoming: ${req.method} ${req.get('host')}${req.url}`);
        next();
    });

    // Debug: Log upgrade requests to see if they reach the server and match the path
    server.on('upgrade', (request, socket, head) => {
        console.log(`[Server] HTTP server upgrade request: ${request.url}`);
    });

    // WebSocket server for chat streaming
    // Disable perMessageDeflate to prevent "Invalid frame header" errors through proxies
    // WebSocket Servers with manual upgrade handling
    // We use noServer: true and handle the upgrade event manually to route to the correct WSS
    const wss = new WebSocketServer({
        noServer: true,
        path: "/ws/chat",
        perMessageDeflate: false
    });
    setupChatWebSocket(wss);

    const termWss = new WebSocketServer({
        noServer: true,
        path: "/ws/terminal",
        perMessageDeflate: false
    });
    setupTerminalWebSocket(termWss);

    // Manual Upgrade Handling
    server.on('upgrade', (request, socket, head) => {
        console.log(`[Server] 🟢 UPGRADE REQUEST received for: ${request.url}`);
        console.log(`[Server] Headers: ${JSON.stringify(request.headers)}`);

        // Use a relative URL for parsing to avoid host issues
        // We only care about the path
        let pathname = request.url;
        try {
            // Handle full URLs if present
            const url = new URL(request.url!, `http://${request.headers.host}`);
            pathname = url.pathname;
        } catch (e) {
            // fallback to raw url if parsing fails (likely relative path)
        }

        if (pathname === '/ws/chat') {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        } else if (pathname === '/ws/terminal' || pathname?.startsWith('/ws/terminal')) {
            // Allow for query params in path check logic if strict equality failed above, 
            // but URL parsing should handle it. Being safe:
            termWss.handleUpgrade(request, socket, head, (ws) => {
                termWss.emit('connection', ws, request);
            });
        } else {
            console.log(`[Server] Unknown upgrade path: ${pathname}`);
            socket.destroy();
        }
    });

    // Middleware
    app.use(helmet({
        contentSecurityPolicy: false, // Disable for API
        frameguard: false, // Allow iframes (Critical for App Previews)
    }));
    app.use(cors({
        origin: process.env.CORS_ORIGIN || "*",
        credentials: true,
    }));
    app.use(compression());
    app.use(express.json({ limit: "10mb" }));
    app.use(express.urlencoded({ extended: true }));

    // -------------------------------------------------------------------------
    // Subdomain Routing Middleware (Replaces Nginx)
    // -------------------------------------------------------------------------
    app.use((req, res, next) => {
        const host = req.get('host');
        if (!host) return next();

        // Match: app-dyad-{id}.domain.com
        // Regex captures the ID (group 1)
        const match = host.match(/^app-dyad-(\d+)\./);

        if (match && match[1]) {
            const appId = match[1];
            // Rewrite URL: /some/path -> /api/apps/{id}/proxy/some/path
            // We prepend the proxy internal route
            req.url = `/api/apps/${appId}/proxy${req.url}`;
            console.log(`[Router] Rewrote subdomain ${host} -> ${req.url}`);
        }
        next();
    });

    app.use(requestLogger);

    // API Routes
    app.use("/api/health", healthRoutes);
    app.use("/api/apps", appsRoutes);
    app.use("/api/chats", chatsRoutes);
    app.use("/api/templates", templatesRoutes);
    app.use("/api/settings", settingsRoutes);
    app.use("/api/github", githubRoutes);
    app.use("/api/mcp", mcpRoutes);
    app.use("/api/prompts", promptsRoutes);
    app.use("/api/chat", chatSSERoutes);  // SSE fallback for chat streaming
    app.use("/api", providersRoutes);


    // Serve static files (Frontend)
    if (process.env.STATIC_DIR) {
        const staticDir = process.env.STATIC_DIR;
        console.log(`Serving static files from: ${staticDir}`);
        app.use(express.static(staticDir));

        // SPA Catch-all route
        app.get("*", (req, res, next) => {
            if (req.path.startsWith("/api")) {
                return next();
            }
            res.sendFile("index.html", { root: staticDir }, (err) => {
                if (err) {
                    next(err);
                }
            });
        });
    }

    // Error handler (must be last)
    app.use(errorHandler);

    // Start server
    server.listen(Number(PORT), HOST, () => {
        console.log(`
╔════════════════════════════════════════════════════════════╗
║                    Dyad Web Server                         ║
╠════════════════════════════════════════════════════════════╣
║  Server running at: http://${HOST}:${PORT}
║  WebSocket endpoint: ws://${HOST}:${PORT}/ws/chat
║  API Base URL: http://${HOST}:${PORT}/api
╚════════════════════════════════════════════════════════════╝
    `);
    });
}

main().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
});
