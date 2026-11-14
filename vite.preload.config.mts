import { defineConfig } from "vite";
import { posthogHiddenSourcemapsPlugin } from "./src/lib/posthog_sourcemaps";

// https://vitejs.dev/config
export default defineConfig({
  plugins: [...posthogHiddenSourcemapsPlugin()],
});
