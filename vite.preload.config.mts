import { defineConfig } from "vite";
import { builtinModules } from "node:module";

// https://vitejs.dev/config
export default defineConfig({
  build: {
    outDir: ".vite/build",
    emptyOutDir: false,
    rolldownOptions: {
      input: "src/preload.ts",
      external: [
        "electron",
        "electron/renderer",
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
      output: {
        format: "cjs",
        entryFileNames: "[name].js",
      },
    },
  },
});
