import { defineConfig } from "vite";
import path from "path";
import { builtinModules } from "node:module";

// Plugin to fix tslib CJS interop issue in Rolldown
// The __toESM helper incorrectly adds .default for tslib
//
// Problem: Rolldown's __toESM helper wraps tslib (which uses module.exports)
// with .default access, causing runtime errors like "Cannot read property
// '__extends' of undefined".
//
// Fix: Post-process generated bundles to remove incorrect .default access.
// This is applied in generateBundle because transform() cannot modify the
// bundler's interop behavior.
//
// TODO: Remove when Rolldown fixes CJS interop
// Track: https://github.com/rolldown/rolldown/issues (search for tslib interop)
function tslibInteropFix() {
  return {
    name: "tslib-interop-fix",
    generateBundle(
      _options: unknown,
      bundle: Record<string, { type: string; code?: string }>,
    ) {
      for (const fileName of Object.keys(bundle)) {
        const chunk = bundle[fileName];
        if (chunk.type === "chunk" && chunk.code) {
          // Pattern: __toESM(require_tslib())).default -> __toESM(require_tslib()))
          chunk.code = chunk.code.replace(
            /(__toESM\(require_tslib\(\)\)\))\.default/g,
            "$1",
          );
        }
      }
    },
  };
}

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Prefer Node.js-targeted exports
    conditions: ["node"],
    mainFields: ["module", "jsnext:main", "jsnext"],
  },
  plugins: [tslibInteropFix()],
  build: {
    outDir: ".vite/build",
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: "src/main.ts",
      formats: ["cjs"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rolldownOptions: {
      external: [
        "electron",
        "electron/main",
        "better-sqlite3",
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
  },
});
