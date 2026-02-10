import { defineConfig } from "vite";
import path from "path";

// https://vitejs.dev/config
// This worker uses child_process.execFile directly instead of dugite
// to avoid module resolution issues in worker threads.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, "workers/git/git_worker.ts"),
      name: "git_worker",
      fileName: "git_worker",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: [
        "node:fs",
        "node:path",
        "node:util",
        "node:child_process",
        "node:worker_threads",
      ],
    },
  },
});
