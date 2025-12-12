import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, Plugin } from "vite";

/**
 * Custom plugin to prevent the full Monaco editor bundle from being included.
 * Redirects bare "monaco-editor" imports to the slim ESM entry point.
 * Language contributions are explicitly imported in src/components/chat/monaco.ts
 */
function monacoEsmPlugin(): Plugin {
  return {
    name: "vite-plugin-monaco-esm",
    enforce: "pre",
    resolveId(source, importer) {
      // Intercept bare "monaco-editor" imports and redirect to slim ESM API
      if (source === "monaco-editor") {
        return this.resolve(
          "monaco-editor/esm/vs/editor/editor.api",
          importer,
          { skipSelf: true },
        );
      }
      return null;
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [monacoEsmPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
