import { defineConfig } from "vite";
import path from "path";

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    sourcemap: true,
    // target: "node16",
    lib: {
      entry: path.resolve(__dirname, "workers/tsc/tsc_worker.ts"),
      name: "tsc_worker",
      fileName: "tsc_worker",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: ["node:fs", "node:path", "node:worker_threads", "typescript"],
      //   output: {
      //     dir: "dist/workers/tsc",
      //   },
    },
    // outDir: "dist/workers/tsc",
    // emptyOutDir: true,
  },
});
