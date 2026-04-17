/**
 * Dataset Training IPC Handlers
 * Connects Dataset Studio datasets to the training pipeline.
 * Supports local LoRA/QLoRA training and OpenAI fine-tuning.
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import { execSync } from "child_process";

import {
  trainOnDataset,
  getTrainingStatus,
  listTrainingJobs,
  cancelTraining,
  listTrainedModels,
  listBaseModels,
} from "@/lib/dataset_training_service";
import { OPENAI_FINE_TUNE_MODELS } from "@/lib/openai_fine_tuning";

import type {
  DatasetTrainingParams,
  DatasetTrainingStatus,
  TrainedModelInfo,
  ListBaseModelsResult,
  TrainingSystemInfo,
  ModelFactorySystemInfo,
} from "../ipc_types";

const logger = log.scope("dataset_training_handlers");

// ============================================================================
// HANDLERS
// ============================================================================

async function handleTrainOnDataset(
  _event: IpcMainInvokeEvent,
  params: DatasetTrainingParams,
): Promise<DatasetTrainingStatus> {
  if (!params.datasetId) {
    throw new Error("datasetId is required");
  }
  if (!params.baseModelId) {
    throw new Error("baseModelId is required");
  }
  if (!params.name) {
    throw new Error("Training job name is required");
  }

  logger.info("Starting dataset training:", params.name, "dataset:", params.datasetId, "provider:", params.openAiConfig ? "openai" : "local");
  return trainOnDataset(params);
}

async function handleGetTrainingStatus(
  _event: IpcMainInvokeEvent,
  jobId: string,
): Promise<DatasetTrainingStatus | null> {
  if (!jobId) {
    throw new Error("jobId is required");
  }
  return getTrainingStatus(jobId);
}

async function handleListTrainingJobs(): Promise<DatasetTrainingStatus[]> {
  return listTrainingJobs();
}

async function handleCancelTraining(
  _event: IpcMainInvokeEvent,
  jobId: string,
): Promise<void> {
  if (!jobId) {
    throw new Error("jobId is required");
  }
  logger.info("Cancelling training job:", jobId);
  return cancelTraining(jobId);
}

async function handleListTrainedModels(): Promise<TrainedModelInfo[]> {
  return listTrainedModels();
}

async function handleListBaseModels(): Promise<ListBaseModelsResult> {
  return listBaseModels();
}

async function handleGetTrainingSystemInfo(): Promise<TrainingSystemInfo> {
  // Re-use the system detection from model_factory_handlers
  const info: TrainingSystemInfo = {
    hasGPU: false,
    hasPython: false,
    hasTransformers: false,
    hasBitsAndBytes: false,
    hasUnsloth: false,
    recommendedMethod: "qlora",
    recommendedQuantization: "4bit",
    maxBatchSize: 1,
    hasOpenAiKey: false,
    openAiModels: OPENAI_FINE_TUNE_MODELS.map((m) => m.id),
  };

  // Check Python
  try {
    const pythonVersion = execSync("python --version", { encoding: "utf-8" }).trim();
    info.hasPython = true;
    info.pythonVersion = pythonVersion.replace("Python ", "");
  } catch {
    try {
      const python3Version = execSync("python3 --version", { encoding: "utf-8" }).trim();
      info.hasPython = true;
      info.pythonVersion = python3Version.replace("Python ", "");
    } catch {
      // No Python found
    }
  }

  // Check GPU (NVIDIA)
  try {
    const nvidiaSmi = execSync(
      "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits",
      { encoding: "utf-8" },
    ).trim();

    if (nvidiaSmi) {
      const [gpuName, vramStr] = nvidiaSmi.split(",").map((s) => s.trim());
      info.hasGPU = true;
      info.gpuName = gpuName;
      info.gpuVRAM = parseInt(vramStr, 10);
    }
  } catch {
    // No GPU
  }

  // Check Python packages
  if (info.hasPython) {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    try {
      execSync(`${pythonCmd} -c "import transformers"`, { encoding: "utf-8" });
      info.hasTransformers = true;
    } catch {}
    try {
      execSync(`${pythonCmd} -c "import bitsandbytes"`, { encoding: "utf-8" });
      info.hasBitsAndBytes = true;
    } catch {}
    try {
      execSync(`${pythonCmd} -c "import unsloth"`, { encoding: "utf-8" });
      info.hasUnsloth = true;
    } catch {}
  }

  // Recommend method based on hardware
  if (info.hasGPU && info.gpuVRAM) {
    if (info.gpuVRAM >= 24000) {
      info.recommendedMethod = "full";
      info.maxBatchSize = 4;
    } else if (info.gpuVRAM >= 12000) {
      info.recommendedMethod = "lora";
      info.maxBatchSize = 4;
    } else if (info.gpuVRAM >= 6000) {
      info.recommendedMethod = "qlora";
      info.maxBatchSize = 2;
    }
  }

  // Check for OpenAI API key in environment
  if (process.env.OPENAI_API_KEY) {
    info.hasOpenAiKey = true;
  }

  return info;
}

// ============================================================================
// REGISTER HANDLERS
// ============================================================================

export function registerDatasetTrainingHandlers() {
  logger.info("Registering dataset training handlers...");

  ipcMain.handle("training:train-on-dataset", handleTrainOnDataset);
  ipcMain.handle("training:get-status", handleGetTrainingStatus);
  ipcMain.handle("training:list-jobs", handleListTrainingJobs);
  ipcMain.handle("training:cancel", handleCancelTraining);
  ipcMain.handle("training:list-trained-models", handleListTrainedModels);
  ipcMain.handle("training:list-base-models", handleListBaseModels);
  ipcMain.handle("training:get-system-info", handleGetTrainingSystemInfo);

  logger.info("Dataset training handlers registered");
}
