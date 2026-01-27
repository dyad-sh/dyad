/**
 * Model Benchmark IPC Handlers
 * Handles IPC communication for the benchmark system
 */

import { ipcMain, BrowserWindow } from "electron";
import { getBenchmarkSystem } from "@/lib/model_benchmark";
import type { BenchmarkId, BenchmarkConfig, BenchmarkEvent } from "@/lib/model_benchmark";

export function registerBenchmarkHandlers(): void {
  const benchmarkSystem = getBenchmarkSystem();
  let subscribedWindow: BrowserWindow | null = null;

  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  ipcMain.handle("benchmark:initialize", async () => {
    await benchmarkSystem.initialize();
    return { success: true };
  });

  ipcMain.handle("benchmark:shutdown", async () => {
    await benchmarkSystem.shutdown();
    return { success: true };
  });

  // ---------------------------------------------------------------------------
  // BENCHMARK EXECUTION
  // ---------------------------------------------------------------------------

  ipcMain.handle("benchmark:run", async (_, config: BenchmarkConfig) => {
    return benchmarkSystem.runBenchmark(config);
  });

  ipcMain.handle("benchmark:cancel", async (_, id: BenchmarkId) => {
    return benchmarkSystem.cancelBenchmark(id);
  });

  // ---------------------------------------------------------------------------
  // QUERIES
  // ---------------------------------------------------------------------------

  ipcMain.handle("benchmark:get", async (_, id: BenchmarkId) => {
    return benchmarkSystem.getBenchmark(id);
  });

  ipcMain.handle("benchmark:list", async (_, limit?: number, offset?: number) => {
    return benchmarkSystem.listBenchmarks(limit, offset);
  });

  ipcMain.handle("benchmark:delete", async (_, id: BenchmarkId) => {
    return benchmarkSystem.deleteBenchmark(id);
  });

  ipcMain.handle("benchmark:get-datasets", async () => {
    return benchmarkSystem.getAvailableDatasets();
  });

  // ---------------------------------------------------------------------------
  // EVENTS
  // ---------------------------------------------------------------------------

  ipcMain.handle("benchmark:subscribe", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return { success: false };

    subscribedWindow = window;

    const unsubscribe = benchmarkSystem.subscribe((benchmarkEvent: BenchmarkEvent) => {
      if (subscribedWindow && !subscribedWindow.isDestroyed()) {
        subscribedWindow.webContents.send("benchmark:event", benchmarkEvent);
      }
    });

    window.on("closed", () => {
      unsubscribe();
      if (subscribedWindow === window) {
        subscribedWindow = null;
      }
    });

    return { success: true };
  });
}
