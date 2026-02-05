import { build } from "vite";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

// Clean .vite directory
fs.rmSync(path.join(ROOT, ".vite"), { recursive: true, force: true });

// Build all targets concurrently
try {
  await Promise.all([
    build({
      configFile: path.join(ROOT, "vite.main.config.mts"),
      mode: "production",
      define: {
        MAIN_WINDOW_VITE_DEV_SERVER_URL: "undefined",
      },
    }),
    build({
      configFile: path.join(ROOT, "vite.preload.config.mts"),
      mode: "production",
    }),
    build({
      configFile: path.join(ROOT, "vite.worker.config.mts"),
      mode: "production",
    }),
    build({
      configFile: path.join(ROOT, "vite.renderer.config.mts"),
      mode: "production",
    }),
  ]);
} catch (error) {
  console.error("Build failed:", error);
  process.exit(1);
}
