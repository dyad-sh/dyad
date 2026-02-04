import { defineConfig } from "vite";
import path from "path";
import { builtinModules } from "node:module";

// Plugin to fix tslib CJS interop issue in Rolldown
// The __toESM helper incorrectly adds .default for tslib
function tslibInteropFix() {
  return {
    name: "tslib-interop-fix",
    transform(code: string, id: string) {
      if (id.includes("tslib")) {
        // tslib uses module.exports = { __extends, ... }
        // We need to ensure it's treated as CJS without .default wrapping
        return null; // Let Rolldown handle it normally
      }
      return null;
    },
    generateBundle(
      _options: unknown,
      bundle: Record<string, { type: string; code?: string }>,
    ) {
      // Fix the incorrect .default access for tslib in all chunks
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
      fileName: () => "[name].js",
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
