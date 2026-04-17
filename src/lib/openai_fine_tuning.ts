/**
 * OpenAI Fine-Tuning Service
 * Handles dataset upload, fine-tuning job creation, status polling, and cancellation
 * via the OpenAI REST API.
 */

import log from "electron-log";
import * as fs from "fs/promises";
import * as path from "path";
import { app } from "electron";

const logger = log.scope("openai_fine_tuning");

// Supported fine-tuning models
export const OPENAI_FINE_TUNE_MODELS = [
  { id: "gpt-5-mini", name: "GPT 5 Mini", description: "Cost-effective fine-tuning" },
  { id: "gpt-5", name: "GPT 5", description: "High-performance fine-tuning" },
  { id: "gpt-5.1-codex-mini", name: "GPT 5.1 Codex Mini", description: "Premium code fine-tuning" },
];

export interface OpenAiFineTuneConfig {
  apiKey: string;
  model: string;
  suffix?: string;
  nEpochs?: number;
  batchSize?: number;
  learningRateMultiplier?: number;
}

interface OpenAiFileResponse {
  id: string;
  object: string;
  bytes: number;
  created_at: number;
  filename: string;
  purpose: string;
  status: string;
}

interface OpenAiFineTuneJob {
  id: string;
  object: string;
  model: string;
  created_at: number;
  finished_at: number | null;
  fine_tuned_model: string | null;
  status: "validating_files" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
  trained_tokens: number | null;
  error: { message: string; code: string } | null;
  hyperparameters: {
    n_epochs: number | string;
    batch_size: number | string;
    learning_rate_multiplier: number | string;
  };
}

interface OpenAiFineTuneEvent {
  id: string;
  object: string;
  created_at: number;
  level: "info" | "warn" | "error";
  message: string;
  data?: Record<string, unknown>;
  type: string;
}

const OPENAI_API_BASE = "https://api.openai.com/v1";

/**
 * Convert Alpaca-format data to OpenAI fine-tuning chat format.
 * OpenAI requires: {"messages": [{"role":"system",...},{"role":"user",...},{"role":"assistant",...}]}
 */
export function convertAlpacaToOpenAI(
  data: Array<{ instruction: string; input: string; output: string }>,
): string {
  const lines: string[] = [];

  for (const item of data) {
    const userContent = item.input
      ? `${item.instruction}\n\n${item.input}`
      : item.instruction;

    const messages = [
      { role: "system" as const, content: "You are a helpful assistant." },
      { role: "user" as const, content: userContent },
      { role: "assistant" as const, content: item.output },
    ];

    lines.push(JSON.stringify({ messages }));
  }

  return lines.join("\n");
}

/**
 * Upload a training file to the OpenAI Files API.
 */
export async function uploadTrainingFile(
  apiKey: string,
  jsonlContent: string,
): Promise<OpenAiFileResponse> {
  // Write to a temp file because the Files API requires multipart upload
  const tempDir = path.join(app.getPath("temp"), "joycreate-openai");
  await fs.mkdir(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `training_${Date.now()}.jsonl`);
  await fs.writeFile(tempPath, jsonlContent, "utf-8");

  try {
    const fileBuffer = await fs.readFile(tempPath);
    const blob = new Blob([fileBuffer], { type: "application/jsonl" });

    const formData = new FormData();
    formData.append("purpose", "fine-tune");
    formData.append("file", blob, `training_${Date.now()}.jsonl`);

    const response = await fetch(`${OPENAI_API_BASE}/files`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`OpenAI file upload failed (${response.status}): ${errBody}`);
    }

    const result = (await response.json()) as OpenAiFileResponse;
    logger.info("Uploaded training file to OpenAI:", result.id, `${result.bytes} bytes`);
    return result;
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}

/**
 * Create a fine-tuning job on OpenAI.
 */
export async function createFineTuneJob(
  apiKey: string,
  trainingFileId: string,
  config: OpenAiFineTuneConfig,
): Promise<OpenAiFineTuneJob> {
  const body: Record<string, unknown> = {
    training_file: trainingFileId,
    model: config.model,
  };

  if (config.suffix) {
    body.suffix = config.suffix;
  }

  const hyperparameters: Record<string, unknown> = {};
  if (config.nEpochs) hyperparameters.n_epochs = config.nEpochs;
  if (config.batchSize) hyperparameters.batch_size = config.batchSize;
  if (config.learningRateMultiplier) hyperparameters.learning_rate_multiplier = config.learningRateMultiplier;

  if (Object.keys(hyperparameters).length > 0) {
    body.hyperparameters = hyperparameters;
  }

  const response = await fetch(`${OPENAI_API_BASE}/fine_tuning/jobs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenAI fine-tuning job creation failed (${response.status}): ${errBody}`);
  }

  const result = (await response.json()) as OpenAiFineTuneJob;
  logger.info("Created OpenAI fine-tune job:", result.id, "model:", config.model);
  return result;
}

/**
 * Get the status of a fine-tuning job.
 */
export async function getFineTuneJobStatus(
  apiKey: string,
  jobId: string,
): Promise<OpenAiFineTuneJob> {
  const response = await fetch(`${OPENAI_API_BASE}/fine_tuning/jobs/${encodeURIComponent(jobId)}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenAI get job status failed (${response.status}): ${errBody}`);
  }

  return (await response.json()) as OpenAiFineTuneJob;
}

/**
 * List events (progress logs) for a fine-tuning job.
 */
export async function listFineTuneEvents(
  apiKey: string,
  jobId: string,
  limit = 20,
): Promise<OpenAiFineTuneEvent[]> {
  const response = await fetch(
    `${OPENAI_API_BASE}/fine_tuning/jobs/${encodeURIComponent(jobId)}/events?limit=${limit}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenAI list events failed (${response.status}): ${errBody}`);
  }

  const body = (await response.json()) as { data: OpenAiFineTuneEvent[] };
  return body.data;
}

/**
 * Cancel a fine-tuning job.
 */
export async function cancelFineTuneJob(
  apiKey: string,
  jobId: string,
): Promise<OpenAiFineTuneJob> {
  const response = await fetch(
    `${OPENAI_API_BASE}/fine_tuning/jobs/${encodeURIComponent(jobId)}/cancel`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenAI cancel job failed (${response.status}): ${errBody}`);
  }

  const result = (await response.json()) as OpenAiFineTuneJob;
  logger.info("Cancelled OpenAI fine-tune job:", jobId);
  return result;
}

/**
 * Map OpenAI job status to our unified status.
 */
export function mapOpenAiStatus(
  status: OpenAiFineTuneJob["status"],
): "preparing" | "queued" | "training" | "completed" | "failed" | "cancelled" {
  switch (status) {
    case "validating_files":
      return "preparing";
    case "queued":
      return "queued";
    case "running":
      return "training";
    case "succeeded":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "preparing";
  }
}
