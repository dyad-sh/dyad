import { builtinModules } from "node:module";
import { defineConfig } from "vite";
import path from "path";

const nodeBuiltins = builtinModules.flatMap((name) => [name, `node:${name}`]);

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    sourcemap: true,
    lib: {
      entry: path.resolve(
        __dirname,
        "workers/code_explorer/code_explorer_worker.ts",
      ),
      name: "code_explorer_worker",
      fileName: "code_explorer_worker",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: [...nodeBuiltins, "typescript"],
    },
  },
});
