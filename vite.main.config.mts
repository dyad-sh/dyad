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
    rollupOptions: {
      external: [
        "better-sqlite3",
        "node-pty",
        "mustardscript",
        // pg requires itself back through pg-pool, and bundling that circle
        // throws "Cannot access 'pg' before initialization" at load. It is a
        // runtime dependency, so requiring it from node_modules is correct.
        "pg",
        "pg-native",
        "pg-cloudflare",
        // Optional native accelerators for `ws`. They are not installed and
        // `ws` falls back to its JS implementations, but Rollup still tries
        // to resolve the requires.
        "bufferutil",
        "utf-8-validate",
      ],
    },
  },
  plugins: [
    {
      name: "restart",
      closeBundle() {
        process.stdin.emit("data", "rs");
      },
    },
  ],
});
