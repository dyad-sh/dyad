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
        // ESM-only packages that need to be externalized
        "helia",
        "@helia/json",
        "@helia/unixfs",
        "blockstore-fs",
        "datastore-fs",
        "multiformats",
        "@libp2p/crypto",
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
