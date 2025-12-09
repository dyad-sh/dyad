/**
 * Vite Configuration for Web SPA Build
 * 
 * This config is used to build a pure web SPA without Electron dependencies.
 * Usage: vite build --config vite.web.config.mts
 */

import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    plugins: [react(), tailwindcss()],

    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },

    // Web build configuration
    build: {
        outDir: "dist-web",
        emptyOutDir: true,
        sourcemap: true,
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, "index.html"),
            },
        },
    },

    // Development server configuration
    server: {
        port: 5173,
        proxy: {
            // Proxy API requests to backend server
            "/api": {
                target: "http://localhost:3007",
                changeOrigin: true,
            },
            // Proxy WebSocket connections
            "/ws": {
                target: "ws://localhost:3007",
                ws: true,
            },
        },
    },

    // Define environment variables for web mode
    define: {
        "import.meta.env.VITE_WEB_MODE": JSON.stringify(true),
        "import.meta.env.VITE_API_URL": JSON.stringify("http://localhost:3007/api"),
        "import.meta.env.VITE_WS_URL": JSON.stringify("ws://localhost:3007"),
    },

    // Optimize dependencies
    optimizeDeps: {
        exclude: [
            // Exclude Electron-specific packages
            "electron",
            "electron-log",
            "better-sqlite3",
        ],
    },
});
