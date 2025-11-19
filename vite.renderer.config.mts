import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 8888,
    strictPort: true,
    fs: {
      strict: false,
    },
    hmr: {
      clientPort: 8888,
    },
    headers: {
      'Cache-Control': 'no-store',
    },
  },
  preview: {
    headers: {
      'Cache-Control': 'no-store',
    },
  },
  optimizeDeps: {
    exclude: ['@modelcontextprotocol/sdk'],
  },
});
