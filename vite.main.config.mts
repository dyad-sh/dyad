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
        // WebSocket optional native modules (ws package)
        "bufferutil",
        "utf-8-validate",
        // Heavy Node.js packages — externalize to avoid heap OOM during bundling
        "googleapis",
        "google-auth-library",
        "playwright-core",
        "ethers",
        "imapflow",
        "nodemailer",
        "mailparser",
        "@microsoft/microsoft-graph-client",
        "@azure/identity",
        "node-ical",
        // Babel/recast — bundling breaks Object.defineProperty in Flow/class init
        "@babel/parser",
        "@babel/traverse",
        "@babel/types",
        "@babel/generator",
        "recast",
        // dugite — must be external so __dirname resolves to its real location
        // for embedded git binary discovery
        "dugite",
      ],
    },
  },
  plugins: [],
});
