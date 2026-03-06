/**
 * Model Download Manager IPC Handlers
 *
 * Exposes GPU detection, system hardware info, model catalog,
 * and Ollama model pull/delete operations.
 *
 * Channels:
 *   model-manager:detect-hardware     — detect GPU & system specs
 *   model-manager:get-catalog         — get recommended model catalog
 *   model-manager:get-filtered-catalog — catalog filtered by hardware
 *   model-manager:pull-model          — pull a model via Ollama
 *   model-manager:delete-model        — delete a model from Ollama
 *   model-manager:list-installed      — list installed Ollama models
 *   model-manager:get-pull-status     — get active pull status
 */

import { ipcMain, BrowserWindow } from "electron";
import log from "electron-log";
import {
  detectSystemHardware,
  MODEL_CATALOG,
  type SystemHardwareInfo,
  type CatalogModel,
} from "../../lib/gpu_detector";

const logger = log.scope("model_download_manager");

// Track active pulls
const activePulls = new Map<
  string,
  { progress: number; status: string; startedAt: number }
>();

export function registerModelDownloadManagerHandlers(): void {
  logger.info("Registering model download manager IPC handlers");

  // --- Hardware Detection ---

  ipcMain.handle("model-manager:detect-hardware", async () => {
    return detectSystemHardware();
  });

  // --- Model Catalog ---

  ipcMain.handle("model-manager:get-catalog", async () => {
    return MODEL_CATALOG;
  });

  ipcMain.handle("model-manager:get-filtered-catalog", async () => {
    const hardware = await detectSystemHardware();
    const maxSize = hardware.maxModelSizeGB;

    return MODEL_CATALOG.map((model) => {
      const fitsHardware = model.sizes.some((s) => s.sizeGB <= maxSize);
      return {
        ...model,
        fitsHardware,
        hardwareWarning: !fitsHardware
          ? `Requires more VRAM/RAM than available (${maxSize}GB max)`
          : undefined,
      };
    });
  });

  // --- Ollama Model Management ---

  ipcMain.handle(
    "model-manager:pull-model",
    async (_event, modelId: string) => {
      if (!modelId) {
        throw new Error(
          "No model ID provided. Please select a valid model to download.",
        );
      }

      const windows = BrowserWindow.getAllWindows();
      const mainWindow = windows[0];

      activePulls.set(modelId, {
        progress: 0,
        status: "starting",
        startedAt: Date.now(),
      });

      try {
        let response: Response;
        try {
          response = await fetch("http://localhost:11434/api/pull", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: modelId, stream: true }),
          });
        } catch (fetchError: any) {
          throw new Error(
            `Cannot connect to Ollama at http://localhost:11434. Make sure Ollama is installed and running. (${fetchError.message})`,
          );
        }

        if (!response.ok) {
          throw new Error(`Ollama pull failed: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let lastProgress = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          for (const line of text.split("\n").filter(Boolean)) {
            try {
              const data = JSON.parse(line);
              let progress = 0;

              if (data.total && data.completed) {
                progress = Math.round((data.completed / data.total) * 100);
              }

              activePulls.set(modelId, {
                progress,
                status: data.status || "downloading",
                startedAt: activePulls.get(modelId)?.startedAt ?? Date.now(),
              });

              // Send progress to renderer (throttled — every 2%)
              if (
                mainWindow &&
                !mainWindow.isDestroyed() &&
                Math.abs(progress - lastProgress) >= 2
              ) {
                mainWindow.webContents.send("model-manager:pull-progress", {
                  modelId,
                  progress,
                  status: data.status,
                  total: data.total,
                  completed: data.completed,
                });
                lastProgress = progress;
              }
            } catch {
              // Non-JSON line, skip
            }
          }
        }

        activePulls.delete(modelId);

        // Notify completion
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("model-manager:pull-complete", {
            modelId,
          });
        }

        return { success: true, modelId };
      } catch (error) {
        activePulls.delete(modelId);
        throw error;
      }
    },
  );

  ipcMain.handle(
    "model-manager:delete-model",
    async (_event, modelId: string) => {
      let response: Response;
      try {
        response = await fetch("http://localhost:11434/api/delete", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: modelId }),
        });
      } catch (fetchError: any) {
        throw new Error(
          `Cannot connect to Ollama at http://localhost:11434. Make sure Ollama is installed and running. (${fetchError.message})`,
        );
      }

      if (!response.ok) {
        throw new Error(`Failed to delete model: ${response.statusText}`);
      }

      return { success: true, modelId };
    },
  );

  ipcMain.handle("model-manager:list-installed", async () => {
    try {
      const response = await fetch("http://localhost:11434/api/tags");
      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.statusText}`);
      }

      const data = await response.json();
      return (data.models || []).map(
        (m: {
          name: string;
          size: number;
          modified_at: string;
          digest: string;
          details?: { parameter_size?: string; family?: string; quantization_level?: string };
        }) => ({
          id: m.name,
          name: m.name,
          sizeBytes: m.size,
          modifiedAt: m.modified_at,
          digest: m.digest,
          parameterSize: m.details?.parameter_size,
          family: m.details?.family,
          quantization: m.details?.quantization_level,
        }),
      );
    } catch {
      return [];
    }
  });

  ipcMain.handle("model-manager:get-pull-status", async () => {
    const status: Record<
      string,
      { progress: number; status: string; durationMs: number }
    > = {};
    for (const [id, pull] of activePulls) {
      status[id] = {
        progress: pull.progress,
        status: pull.status,
        durationMs: Date.now() - pull.startedAt,
      };
    }
    return status;
  });
}
