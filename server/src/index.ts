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
import chatsRoutes from "./routes/chats.js";
import settingsRoutes from "./routes/settings.js";
import githubRoutes from "./routes/github.js";
import mcpRoutes from "./routes/mcp.js";
import promptsRoutes from "./routes/prompts.js";
import providersRoutes from "./routes/providers.js";
import { setupChatWebSocket } from "./routes/chatStream.js";

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "0.0.0.0";

async function main() {
    // Initialize database
    console.log("Initializing database...");
    await initializeDatabase();

    // Create Express app
    const app = express();
    const server = createServer(app);

    // WebSocket server for chat streaming
    const wss = new WebSocketServer({ server, path: "/ws/chat" });
    setupChatWebSocket(wss);

    // Middleware
    app.use(helmet({
        contentSecurityPolicy: false, // Disable for API
    }));
    app.use(cors({
        origin: process.env.CORS_ORIGIN || "*",
        credentials: true,
    }));
    app.use(compression());
    app.use(express.json({ limit: "10mb" }));
    app.use(express.urlencoded({ extended: true }));
    app.use(requestLogger);

    // API Routes
    app.use("/api/health", healthRoutes);
    app.use("/api/apps", appsRoutes);
    app.use("/api/chats", chatsRoutes);
    app.use("/api/settings", settingsRoutes);
    app.use("/api/github", githubRoutes);
    app.use("/api/mcp", mcpRoutes);
    app.use("/api/prompts", promptsRoutes);
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
