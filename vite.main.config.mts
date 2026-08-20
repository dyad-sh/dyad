import { builtinModules } from "node:module";
import { defineConfig } from "vite";
import path from "path";
import { assertDeferredMainBootstrapBundle } from "./src/lib/main_bootstrap_bundle";

const nodeBuiltins = builtinModules.flatMap((name) => [name, `node:${name}`]);

// https://vitejs.dev/config
export default defineConfig(({ forgeConfigSelf }) => ({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "pg-schema-classifier": path.resolve(
        __dirname,
        "./packages/pg-schema-classifier/src/index.ts",
      ),
      "ts-pg-schema-diff": path.resolve(
        __dirname,
        "./packages/ts-pg-schema-diff/src/index.ts",
      ),
    },
  },
  build: {
    // Defining lib here makes the Forge/Vite contract explicit. Forge skips
    // its CommonJS defaults whenever the user config supplies this object.
    lib: {
      entry: forgeConfigSelf.entry,
      fileName: (_format, entryName) => `${entryName}.js`,
      formats: ["cjs"],
    },
    rollupOptions: {
      output: {
        // Squirrel handling depends on main.ts remaining behind the conditional
        // dynamic import in main_bootstrap.ts.
        inlineDynamicImports: false,
      },
      external: [
        ...nodeBuiltins,
        "better-sqlite3",
        "dyad-keychain-reader",
        "node-pty",
        "ssh2",
        "mustardscript",
        "pg",
        "ws",
      ],
    },
  },
  plugins: [
    {
      name: "verify-deferred-main-bootstrap",
      generateBundle(outputOptions, bundle) {
        assertDeferredMainBootstrapBundle(outputOptions, bundle);
      },
    },
    {
      name: "restart",
      closeBundle() {
        process.stdin.emit("data", "rs");
      },
    },
  ],
}));
