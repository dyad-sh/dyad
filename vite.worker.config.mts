import { defineConfig } from "vite";
import path from "path";
import { builtinModules } from "node:module";

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: ".vite/build",
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, "workers/tsc/tsc_worker.ts"),
      name: "tsc_worker",
      fileName: "tsc_worker",
      formats: ["cjs"],
    },
    rolldownOptions: {
      external: [
        "electron",
        "typescript",
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
  },
});
