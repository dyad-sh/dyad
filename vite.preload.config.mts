import path from "node:path";
import { defineConfig } from "vite";

/**
 * The preload bundle.
 *
 * It resolves "@/" like the main and renderer configs do. It did not, and the
 * first contract to use an "@/" import took the whole preload build down —
 * which surfaces as every IPC call failing with "IPC renderer not available",
 * because without a preload there is no bridge at all.
 */
// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
