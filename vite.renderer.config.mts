import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Split vendor dependencies into separate chunks for better caching
          if (id.includes("node_modules")) {
            // React and related libraries
            if (id.includes("react") || id.includes("react-dom")) {
              return "vendor-react";
            }

            // Monaco Editor (large dependency)
            if (id.includes("monaco-editor") || id.includes("@monaco-editor")) {
              return "vendor-monaco";
            }

            // Radix UI components
            if (id.includes("@radix-ui")) {
              return "vendor-radix";
            }

            // TanStack libraries (Router, Query)
            if (id.includes("@tanstack")) {
              return "vendor-tanstack";
            }

            // AI SDK and related
            if (id.includes("@ai-sdk") || id.includes("ai")) {
              return "vendor-ai";
            }

            // Lexical editor
            if (id.includes("lexical") || id.includes("@lexical")) {
              return "vendor-lexical";
            }

            // Markdown and syntax highlighting
            if (id.includes("react-markdown") || id.includes("shiki") || id.includes("react-shiki")) {
              return "vendor-markdown";
            }

            // Other large vendor libraries
            return "vendor";
          }

          // Split large UI components
          if (id.includes("/src/components/") && id.includes(".tsx")) {
            // Settings components
            if (id.includes("/components/settings/")) {
              return "components-settings";
            }
            // Chat components
            if (id.includes("/components/chat/")) {
              return "components-chat";
            }
          }
        },
      },
    },
    // Optimize chunk size warnings threshold
    chunkSizeWarningLimit: 1000,
  },
});
