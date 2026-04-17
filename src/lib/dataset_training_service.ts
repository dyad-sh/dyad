/**
 * Dataset Training Service
 * Bridges Dataset Studio datasets to the training pipeline.
 * Supports both local LoRA/QLoRA training and OpenAI fine-tuning.
 */

import log from "electron-log";
import * as path from "path";
import * as fs from "fs/promises";
import { app } from "electron";
import { db } from "@/db";
import { eq, and, sql, count, desc } from "drizzle-orm";
import {
  studioDatasets,
  datasetItems,
  contentBlobs,
} from "@/db/schema";
import { modelRegistryEntries } from "@/db/model_registry_schema";
import { LocalFineTuning } from "@/lib/local_fine_tuning";
import {
  convertAlpacaToOpenAI,
  uploadTrainingFile,
  createFineTuneJob,
  getFineTuneJobStatus,
  cancelFineTuneJob,
  mapOpenAiStatus,
  OPENAI_FINE_TUNE_MODELS,
} from "@/lib/openai_fine_tuning";

import type {
  DatasetTrainingParams,
  DatasetTrainingStatus,
  TrainedModelInfo,
  ListBaseModelsResult,
  TrainingSystemInfo,
} from "@/ipc/ipc_types";

const logger = log.scope("dataset_training_service");

// In-memory tracking of active training jobs
const activeJobs = new Map<string, DatasetTrainingStatus>();

// Map of OpenAI job IDs to our internal job IDs for polling
const openAiJobMapping = new Map<string, { internalId: string; apiKey: string }>();

// ============================================================================
// CONTENT RETRIEVAL
// ============================================================================

function getContentStoreDir(): string {
  return path.join(app.getPath("userData"), "content-store");
}

async function readContentByHash(hash: string): Promise<string> {
  const storeDir = getContentStoreDir();
  const prefix = hash.substring(0, 2);
  const filePath = path.join(storeDir, prefix, hash);
  return fs.readFile(filePath, "utf-8");
}

// ============================================================================
// DATASET PREPARATION
// ============================================================================

/**
 * Load dataset items and convert to training-ready format.
 */
export async function prepareDatasetForTraining(
  datasetId: string,
  options: {
    format: "alpaca" | "sharegpt" | "oasst" | "raw";
    autoSplitRatio?: number;
    filterByModality?: string;
    minQualityScore?: number;
  },
): Promise<{
  data: Array<{ instruction: string; input: string; output: string }>;
  trainCount: number;
  valCount: number;
  totalItems: number;
}> {
  // Verify dataset exists
  const [dataset] = await db
    .select()
    .from(studioDatasets)
    .where(eq(studioDatasets.id, datasetId))
    .limit(1);

  if (!dataset) {
    throw new Error(`Dataset not found: ${datasetId}`);
  }

  // Build query conditions
  const conditions = [eq(datasetItems.datasetId, datasetId)];

  if (options.filterByModality) {
    conditions.push(eq(datasetItems.modality, options.filterByModality as "text" | "image" | "audio" | "video" | "context"));
  }

  // Fetch all items
  const items = await db
    .select()
    .from(datasetItems)
    .where(and(...conditions))
    .orderBy(datasetItems.createdAt);

  if (items.length === 0) {
    throw new Error("Dataset has no items matching the specified criteria");
  }

  logger.info(`Preparing ${items.length} items from dataset "${dataset.name}" for training`);

  // Convert items to training format
  const trainingData: Array<{ instruction: string; input: string; output: string }> = [];

  for (const item of items) {
    try {
      // Filter by quality score if specified
      if (options.minQualityScore && item.qualitySignalsJson) {
        const quality = item.qualitySignalsJson as { overallScore?: number };
        if (quality.overallScore && quality.overallScore < options.minQualityScore) {
          continue;
        }
      }

      // Read content from content-addressed storage
      let content: string;
      try {
        content = await readContentByHash(item.contentHash);
      } catch {
        logger.warn(`Skipping item ${item.id}: content not found for hash ${item.contentHash}`);
        continue;
      }

      // Parse and convert based on modality
      if (item.modality === "text") {
        const parsed = tryParseJson(content);

        if (parsed) {
          // JSON content — extract fields based on format
          const entry = extractTrainingEntry(parsed, options.format);
          if (entry) {
            trainingData.push(entry);
          }
        } else {
          // Plain text — use as response with a generic instruction
          trainingData.push({
            instruction: "Continue the following text or respond appropriately.",
            input: "",
            output: content.trim(),
          });
        }
      } else if (item.modality === "context") {
        // Context packs may contain structured data
        const parsed = tryParseJson(content);
        if (parsed) {
          const entry = extractTrainingEntry(parsed, options.format);
          if (entry) {
            trainingData.push(entry);
          }
        }
      }
      // Skip image/audio/video items for text-based training
    } catch (err) {
      logger.warn(`Error processing item ${item.id}:`, err);
    }
  }

  if (trainingData.length === 0) {
    throw new Error("No usable training data could be extracted from the dataset items");
  }

  // Count existing splits
  const trainItems = items.filter((i) => i.split === "train").length;
  const valItems = items.filter((i) => i.split === "val").length;

  logger.info(`Prepared ${trainingData.length} training entries from ${items.length} items`);

  return {
    data: trainingData,
    trainCount: trainItems || Math.floor(trainingData.length * (1 - (options.autoSplitRatio || 0.1))),
    valCount: valItems || Math.ceil(trainingData.length * (options.autoSplitRatio || 0.1)),
    totalItems: items.length,
  };
}

function tryParseJson(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function extractTrainingEntry(
  obj: Record<string, unknown>,
  format: string,
): { instruction: string; input: string; output: string } | null {
  switch (format) {
    case "alpaca":
      if (obj.instruction || obj.input || obj.output) {
        return {
          instruction: String(obj.instruction || "Respond to the following."),
          input: String(obj.input || ""),
          output: String(obj.output || obj.response || obj.completion || ""),
        };
      }
      break;
    case "sharegpt":
      if (Array.isArray(obj.conversations)) {
        const human = obj.conversations.find((c: { from: string }) => c.from === "human");
        const gpt = obj.conversations.find(
          (c: { from: string }) => c.from === "gpt" || c.from === "assistant",
        );
        if (human && gpt) {
          return {
            instruction: "",
            input: String((human as { value: string }).value),
            output: String((gpt as { value: string }).value),
          };
        }
      }
      break;
    case "oasst":
      if (obj.INSTRUCTION || obj.RESPONSE) {
        return {
          instruction: String(obj.INSTRUCTION || obj.instruction || ""),
          input: "",
          output: String(obj.RESPONSE || obj.response || ""),
        };
      }
      break;
    default:
      // Raw — try common field names
      if (obj.prompt || obj.question || obj.input) {
        return {
          instruction: String(obj.instruction || ""),
          input: String(obj.prompt || obj.question || obj.input || ""),
          output: String(obj.output || obj.response || obj.answer || obj.completion || ""),
        };
      }
  }

  // Fallback: if we have any string fields, try to make a pair
  const keys = Object.keys(obj);
  if (keys.length >= 2) {
    const values = keys.map((k) => String(obj[k])).filter((v) => v.length > 0);
    if (values.length >= 2) {
      return {
        instruction: "Respond to the following.",
        input: values[0],
        output: values[1],
      };
    }
  }

  return null;
}

// ============================================================================
// TRAINING PIPELINE
// ============================================================================

/**
 * Start training on a dataset — local or OpenAI depending on params.
 */
export async function trainOnDataset(
  params: DatasetTrainingParams,
): Promise<DatasetTrainingStatus> {
  const jobId = `dtrain_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Fetch dataset metadata
  const [dataset] = await db
    .select()
    .from(studioDatasets)
    .where(eq(studioDatasets.id, params.datasetId))
    .limit(1);

  if (!dataset) {
    throw new Error(`Dataset not found: ${params.datasetId}`);
  }

  const status: DatasetTrainingStatus = {
    jobId,
    name: params.name,
    datasetId: params.datasetId,
    datasetName: dataset.name,
    baseModelId: params.baseModelId,
    method: params.method,
    provider: params.openAiConfig ? "openai" : "local",
    status: "preparing",
    progress: 0,
    itemsProcessed: 0,
    totalDatasetItems: dataset.itemCount ?? 0,
    createdAt: Date.now(),
  };

  activeJobs.set(jobId, status);

  // Run the pipeline asynchronously
  if (params.openAiConfig) {
    runOpenAiPipeline(jobId, params, status).catch((err) => {
      status.status = "failed";
      status.error = err instanceof Error ? err.message : String(err);
      status.completedAt = Date.now();
      logger.error("OpenAI training pipeline failed:", err);
    });
  } else {
    runLocalPipeline(jobId, params, status).catch((err) => {
      status.status = "failed";
      status.error = err instanceof Error ? err.message : String(err);
      status.completedAt = Date.now();
      logger.error("Local training pipeline failed:", err);
    });
  }

  return status;
}

/**
 * Run the local training pipeline:
 * 1. Prepare dataset from dataset items
 * 2. Create JSONL files via LocalFineTuning
 * 3. Create training job
 * 4. Start training (spawns Python subprocess)
 */
async function runLocalPipeline(
  jobId: string,
  params: DatasetTrainingParams,
  status: DatasetTrainingStatus,
): Promise<void> {
  try {
    // 1. Prepare dataset
    const { data, totalItems } = await prepareDatasetForTraining(params.datasetId, {
      format: params.datasetFormat,
      autoSplitRatio: params.autoSplitRatio,
      filterByModality: params.filterByModality,
      minQualityScore: params.minQualityScore,
    });

    status.totalDatasetItems = totalItems;
    status.itemsProcessed = data.length;

    // 2. Create JSONL dataset via LocalFineTuning
    const ft = new LocalFineTuning();
    await ft.initialize();

    const timestamp = new Date().toISOString().slice(0, 10);
    const datasetResult = await ft.createDataset({
      name: params.outputName || `training-${params.datasetId.slice(0, 8)}-${timestamp}`,
      format: params.datasetFormat === "raw" ? "custom" : params.datasetFormat,
      data,
      validationSplit: params.autoSplitRatio || 0.1,
      metadata: {
        source: "dataset_training_service",
        sourceDatasetId: params.datasetId,
        method: params.method,
      },
    });

    logger.info(`Created training dataset: ${datasetResult.id} with ${data.length} samples`);

    // 3. Create training job
    const job = await ft.createTrainingJob({
      name: params.name,
      baseModel: params.baseModelId as "tinyllama",
      baseModelPath: "",
      datasetId: datasetResult.id,
      method: params.method === "dora" ? "lora" : (params.method as "lora" | "qlora" | "full"),
      config: {
        loraR: params.hyperparameters.loraRank || 8,
        loraAlpha: params.hyperparameters.loraAlpha || 16,
        loraDropout: params.hyperparameters.loraDropout || 0.05,
        batchSize: params.hyperparameters.batchSize,
        learningRate: params.hyperparameters.learningRate,
        epochs: params.hyperparameters.epochs,
        gradientCheckpointing: params.hyperparameters.gradientCheckpointing,
      },
      metadata: {
        source: "dataset_training_service",
        datasetId: params.datasetId,
        jobId,
      },
    });

    status.status = "training";
    status.startedAt = Date.now();
    status.outputPath = job.outputPath;

    // 4. Start training
    ft.on("progress", (progress) => {
      status.progress = progress.progress || status.progress;
      status.currentEpoch = progress.epoch;
      status.totalEpochs = params.hyperparameters.epochs;
      status.currentStep = progress.step;
      status.totalSteps = progress.totalSteps;
      status.currentLoss = progress.loss;
    });

    ft.on("job:completed", (completedJob) => {
      if (completedJob.id === job.id) {
        status.status = "completed";
        status.progress = 100;
        status.completedAt = Date.now();
        status.outputPath = completedJob.outputPath;
        logger.info(`Local training completed for job ${jobId}`);
      }
    });

    ft.on("job:failed", ({ job: failedJob, error }) => {
      if (failedJob.id === job.id) {
        status.status = "failed";
        status.error = String(error);
        status.completedAt = Date.now();
        logger.error(`Local training failed for job ${jobId}:`, error);
      }
    });

    await ft.startTraining(job.id);
  } catch (err) {
    status.status = "failed";
    status.error = err instanceof Error ? err.message : String(err);
    status.completedAt = Date.now();
    throw err;
  }
}

/**
 * Run the OpenAI fine-tuning pipeline:
 * 1. Prepare dataset from dataset items
 * 2. Convert to OpenAI messages format
 * 3. Upload file to OpenAI
 * 4. Create fine-tuning job
 * 5. Status is polled via getTrainingStatus()
 */
async function runOpenAiPipeline(
  jobId: string,
  params: DatasetTrainingParams,
  status: DatasetTrainingStatus,
): Promise<void> {
  const openAiConfig = params.openAiConfig!;

  try {
    // 1. Prepare dataset
    const { data, totalItems } = await prepareDatasetForTraining(params.datasetId, {
      format: params.datasetFormat,
      autoSplitRatio: params.autoSplitRatio,
      filterByModality: params.filterByModality,
      minQualityScore: params.minQualityScore,
    });

    status.totalDatasetItems = totalItems;
    status.itemsProcessed = data.length;

    // 2. Convert to OpenAI format
    status.status = "uploading";
    const jsonlContent = convertAlpacaToOpenAI(data);

    // 3. Upload to OpenAI
    const fileResult = await uploadTrainingFile(openAiConfig.apiKey, jsonlContent);
    logger.info(`Uploaded training file to OpenAI: ${fileResult.id}`);

    // 4. Create fine-tuning job
    status.status = "queued";
    const ftJob = await createFineTuneJob(openAiConfig.apiKey, fileResult.id, openAiConfig);

    status.openAiJobId = ftJob.id;
    status.startedAt = Date.now();

    // Store mapping for polling
    openAiJobMapping.set(ftJob.id, { internalId: jobId, apiKey: openAiConfig.apiKey });

    logger.info(`Created OpenAI fine-tune job: ${ftJob.id}`);
  } catch (err) {
    status.status = "failed";
    status.error = err instanceof Error ? err.message : String(err);
    status.completedAt = Date.now();
    throw err;
  }
}

// ============================================================================
// STATUS & MANAGEMENT
// ============================================================================

/**
 * Get training job status — polls OpenAI if needed.
 */
export async function getTrainingStatus(
  jobId: string,
): Promise<DatasetTrainingStatus | null> {
  const status = activeJobs.get(jobId);
  if (!status) return null;

  // If this is an OpenAI job, poll for updates
  if (status.provider === "openai" && status.openAiJobId) {
    const mapping = openAiJobMapping.get(status.openAiJobId);
    if (mapping) {
      try {
        const openAiJob = await getFineTuneJobStatus(mapping.apiKey, status.openAiJobId);
        status.status = mapOpenAiStatus(openAiJob.status);

        if (openAiJob.fine_tuned_model) {
          status.openAiModelId = openAiJob.fine_tuned_model;
        }

        if (openAiJob.status === "succeeded") {
          status.progress = 100;
          status.completedAt = status.completedAt || Date.now();
        } else if (openAiJob.status === "failed") {
          status.error = openAiJob.error?.message || "OpenAI fine-tuning failed";
          status.completedAt = status.completedAt || Date.now();
        } else if (openAiJob.status === "running") {
          // Estimate progress based on trained tokens if available
          if (openAiJob.trained_tokens) {
            status.progress = Math.min(95, status.progress + 5);
          }
        }
      } catch (err) {
        logger.warn("Failed to poll OpenAI job status:", err);
      }
    }
  }

  return status;
}

/**
 * List all active and recent training jobs.
 */
export function listTrainingJobs(): DatasetTrainingStatus[] {
  return Array.from(activeJobs.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Cancel a training job.
 */
export async function cancelTraining(jobId: string): Promise<void> {
  const status = activeJobs.get(jobId);
  if (!status) {
    throw new Error(`Training job not found: ${jobId}`);
  }

  if (status.provider === "openai" && status.openAiJobId) {
    const mapping = openAiJobMapping.get(status.openAiJobId);
    if (mapping) {
      await cancelFineTuneJob(mapping.apiKey, status.openAiJobId);
      openAiJobMapping.delete(status.openAiJobId);
    }
  }

  status.status = "cancelled";
  status.completedAt = Date.now();
  logger.info(`Cancelled training job: ${jobId}`);
}

/**
 * List trained models from the model registry.
 */
export async function listTrainedModels(): Promise<TrainedModelInfo[]> {
  const models = await db
    .select()
    .from(modelRegistryEntries)
    .where(eq(modelRegistryEntries.modelType, "fine_tuned"))
    .orderBy(desc(modelRegistryEntries.createdAt));

  const result: TrainedModelInfo[] = models.map((m) => {
    const provenance = m.provenanceJson as {
      datasetId?: string;
      trainingMethod?: string;
    } | null;

    return {
      id: m.id,
      name: m.name,
      baseModelId: m.baseModelId || "",
      method: m.adapterType || "lora",
      datasetId: provenance?.datasetId,
      datasetName: undefined,
      provider: m.adapterType === "openai" ? ("openai" as const) : ("local" as const),
      status: "completed" as const,
      adapterPath: m.localPath || undefined,
      createdAt: m.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
    };
  });

  // Also include active in-progress jobs
  for (const job of activeJobs.values()) {
    if (job.status === "training" || job.status === "queued" || job.status === "preparing" || job.status === "uploading") {
      result.push({
        id: job.jobId,
        name: job.name,
        baseModelId: job.baseModelId,
        method: job.method,
        datasetId: job.datasetId,
        datasetName: job.datasetName,
        provider: job.provider,
        status: "training",
        createdAt: job.createdAt,
      });
    }
  }

  return result;
}

/**
 * List available base models for training.
 */
export async function listBaseModels(): Promise<ListBaseModelsResult> {
  const result: ListBaseModelsResult = {
    local: [],
    openai: OPENAI_FINE_TUNE_MODELS,
  };

  // Try to list Ollama models
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags");
    if (response.ok) {
      const data = (await response.json()) as {
        models: Array<{ name: string; size: number; details?: { quantization_level?: string } }>;
      };
      result.local = data.models.map((m) => ({
        id: m.name,
        name: m.name,
        size: formatBytes(m.size),
        quantization: m.details?.quantization_level,
      }));
    }
  } catch {
    logger.debug("Ollama not available for listing local models");
  }

  return result;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
