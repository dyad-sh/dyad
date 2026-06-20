import { builtinModules } from "node:module";
import { defineConfig } from "vite";
import path from "path";

const nodeBuiltins = builtinModules.flatMap((name) => [name, `node:${name}`]);

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
      external: [...nodeBuiltins, "typescript", "pg"],
      //   output: {
      //     dir: "dist/workers/tsc",
      //   },
    },
    // outDir: "dist/workers/tsc",
    // emptyOutDir: true,
  },
});
