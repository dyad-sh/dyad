import { defineConfig, Plugin, HtmlTagDescriptor } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";

export function devErrorAndNavigationPlugin(): Plugin {
  let stacktraceJsContent: string | null = null;
  let dyadShimContent: string | null = null;

  return {
    name: "dev-error-and-navigation-handler",
    apply: "serve",

    configResolved() {
      const stackTraceLibPath = path.join(
        "node_modules",
        "stacktrace-js",
        "dist",
        "stacktrace.min.js",
      );
      if (stackTraceLibPath) {
        try {
          stacktraceJsContent = fs.readFileSync(stackTraceLibPath, "utf-8");
        } catch (error) {
          console.error(
            `[dyad-shim] Failed to read stacktrace.js from ${stackTraceLibPath}:`,
            error,
          );
          stacktraceJsContent = null;
        }
      } else {
        console.error(`[dyad-shim] stacktrace.js not found.`);
      }

      const dyadShimPath = path.join("dyad-shim.js");
      if (dyadShimPath) {
        try {
          dyadShimContent = fs.readFileSync(dyadShimPath, "utf-8");
        } catch (error) {
          console.error(
            `[dyad-shim] Failed to read dyad-shim from ${dyadShimPath}:`,
            error,
          );
          dyadShimContent = null;
        }
      } else {
        console.error(`[dyad-shim] stacktrace.js not found.`);
      }
    },

    transformIndexHtml(html) {
      const tags: HtmlTagDescriptor[] = [];

      // 1. Inject stacktrace.js
      if (stacktraceJsContent) {
        tags.push({
          tag: "script",
          injectTo: "head-prepend",
          children: stacktraceJsContent,
        });
      } else {
        tags.push({
          tag: "script",
          injectTo: "head-prepend",
          children:
            "console.warn('[dyad-shim] stacktrace.js library was not injected.');",
        });
      }

      // 2. Inject dyad shim
      if (dyadShimContent) {
        tags.push({
          tag: "script",
          injectTo: "head-prepend",
          children: dyadShimContent,
        });
      } else {
        tags.push({
          tag: "script",
          injectTo: "head-prepend",
          children: "console.warn('[dyad-shim] dyad shim was not injected.');",
        });
      }

      return { html, tags };
    },
  };
}

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), devErrorAndNavigationPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
