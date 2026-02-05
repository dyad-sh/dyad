import { createServer, build } from "vite";
import { spawn } from "node:child_process";
import electron from "electron";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

// Clean .vite directory
fs.rmSync(path.join(ROOT, ".vite"), { recursive: true, force: true });

// 1. Start renderer dev server
const rendererServer = await createServer({
  configFile: path.join(ROOT, "vite.renderer.config.mts"),
  mode: "development",
});
await rendererServer.listen();
rendererServer.printUrls();

const addressInfo = rendererServer.httpServer.address();
if (!addressInfo) {
  throw new Error("Failed to start renderer server - no address info");
}
const rendererUrl =
  typeof addressInfo === "string"
    ? addressInfo
    : `http://localhost:${addressInfo.port}`;

// 2. Electron process management
let electronProcess = null;
let isShuttingDown = false;

function startElectron() {
  if (isShuttingDown) return;

  electronProcess = spawn(/** @type {string} */ (electron), ["."], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: "development" },
    stdio: "inherit",
  });

  electronProcess.on("exit", (_code) => {
    if (!isShuttingDown) {
      // Electron was closed by user, shut everything down
      shutdown();
    }
  });
}

function restartElectron() {
  if (isShuttingDown) return;
  if (electronProcess) {
    electronProcess.removeAllListeners("exit");
    electronProcess.kill();
    electronProcess = null;
  }
  startElectron();
}

// 3. Build preload in watch mode
let preloadReady = false;
const preloadWatcher = await build({
  configFile: path.join(ROOT, "vite.preload.config.mts"),
  mode: "development",
  build: {
    minify: false,
    watch: {},
  },
  plugins: [
    {
      name: "preload-watcher",
      closeBundle() {
        if (preloadReady) {
          // Preload rebuilt — tell renderer to reload
          rendererServer.ws.send({ type: "full-reload" });
          console.log("[dev] preload rebuilt — reloading renderer");
        }
        preloadReady = true;
      },
    },
  ],
});

// 4. Build worker in watch mode
const workerWatcher = await build({
  configFile: path.join(ROOT, "vite.worker.config.mts"),
  mode: "development",
  build: {
    minify: false,
    watch: {},
  },
});

// 5. Build main in watch mode
let mainReady = false;
const mainWatcher = await build({
  configFile: path.join(ROOT, "vite.main.config.mts"),
  mode: "development",
  define: {
    MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify(rendererUrl),
  },
  build: {
    minify: false,
    watch: {},
  },
  plugins: [
    {
      name: "main-watcher",
      closeBundle() {
        if (mainReady) {
          // Main rebuilt — restart electron
          console.log("[dev] main rebuilt — restarting electron");
          restartElectron();
        } else {
          mainReady = true;
          // First build complete — start electron
          console.log("[dev] initial build complete — starting electron");
          startElectron();
        }
      },
    },
  ],
});

// 6. Shutdown handling
async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("\n[dev] shutting down...");

  if (electronProcess) {
    electronProcess.removeAllListeners("exit");
    electronProcess.kill();
  }

  // Close watchers — await all closures
  await Promise.all(
    [mainWatcher, preloadWatcher, workerWatcher]
      .filter((w) => w && typeof w.close === "function")
      .map((w) => w.close()),
  );

  await rendererServer.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
