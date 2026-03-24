/**
 * Vite config for the ProteaAI web build.
 *
 * Differences from the Electron renderer config:
 *  - Entry point: src/web/web-entry.tsx  (injects web IPC adapter)
 *  - Output:      dist/web/
 *  - Dev proxy:   /api → http://localhost:3001  (forwards to Express server)
 *  - Mode:        web (sets import.meta.env.MODE = "web")
 */

import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const ReactCompilerConfig = {};

export default defineConfig({
  root: ".",
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", ReactCompilerConfig]],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Prevent accidental electron imports from reaching the browser bundle
      electron: path.resolve(__dirname, "src/web/electron-stub.ts"),
    },
  },
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.web.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Forward IPC API calls to the Express server
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      // Forward WebSocket upgrade to Express server
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  define: {
    // Let app code detect it's running in web mode
    "import.meta.env.PROTEAAI_WEB_MODE": JSON.stringify("true"),
  },
});
