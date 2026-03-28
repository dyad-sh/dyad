/**
 * HuggingFace Hub IPC Handlers
 * Search models/datasets, download, push adapters, and manage HF auth
 */

import { ipcMain, app } from "electron";
import log from "electron-log";
import path from "path";
import fs from "fs/promises";
import { existsSync, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { readSettings, writeSettings } from "../../main/settings";

const logger = log.scope("huggingface_handlers");

const HF_API_URL = "https://huggingface.co/api";

// =============================================================================
// Helpers
// =============================================================================

function getHfToken(): string | null {
  const settings = readSettings();
  return settings.huggingFaceToken?.value || null;
}

function hfHeaders(token?: string | null): Record<string, string> {
  const t = token ?? getHfToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (t) headers.Authorization = `Bearer ${t}`;
  return headers;
}

function getModelsDir(): string {
  return path.join(app.getPath("userData"), "hf-models");
}

function getDatasetsDir(): string {
  return path.join(app.getPath("userData"), "hf-datasets");
}

// =============================================================================
// Types
// =============================================================================

export interface HfModelInfo {
  id: string;
  modelId: string;
  author?: string;
  sha?: string;
  lastModified?: string;
  private: boolean;
  disabled: boolean;
  gated: boolean | string;
  pipeline_tag?: string;
  tags: string[];
  downloads: number;
  likes: number;
  library_name?: string;
  siblings?: { rfilename: string; size?: number }[];
}

export interface HfDatasetInfo {
  id: string;
  author?: string;
  sha?: string;
  lastModified?: string;
  private: boolean;
  disabled: boolean;
  gated: boolean | string;
  tags: string[];
  downloads: number;
  likes: number;
  description?: string;
}

export interface HfSearchParams {
  query: string;
  limit?: number;
  filter?: string;
  sort?: string;
  direction?: string;
}

export interface HfDownloadProgress {
  modelId: string;
  file: string;
  downloaded: number;
  total: number;
  percent: number;
}

// =============================================================================
// Search Models
// =============================================================================

async function handleSearchModels(
  _: Electron.IpcMainInvokeEvent,
  params: HfSearchParams,
): Promise<HfModelInfo[]> {
  const { query, limit = 20, filter, sort = "downloads", direction = "-1" } = params;
  const searchParams = new URLSearchParams({
    search: query,
    limit: String(limit),
    sort,
    direction,
  });
  if (filter) searchParams.set("filter", filter);

  const res = await fetch(`${HF_API_URL}/models?${searchParams}`, {
    headers: hfHeaders(),
  });
  if (!res.ok) {
    throw new Error(`HuggingFace API error: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<HfModelInfo[]>;
}

// =============================================================================
// Search Datasets
// =============================================================================

async function handleSearchDatasets(
  _: Electron.IpcMainInvokeEvent,
  params: HfSearchParams,
): Promise<HfDatasetInfo[]> {
  const { query, limit = 20, filter, sort = "downloads", direction = "-1" } = params;
  const searchParams = new URLSearchParams({
    search: query,
    limit: String(limit),
    sort,
    direction,
  });
  if (filter) searchParams.set("filter", filter);

  const res = await fetch(`${HF_API_URL}/datasets?${searchParams}`, {
    headers: hfHeaders(),
  });
  if (!res.ok) {
    throw new Error(`HuggingFace API error: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<HfDatasetInfo[]>;
}

// =============================================================================
// Model Info
// =============================================================================

async function handleModelInfo(
  _: Electron.IpcMainInvokeEvent,
  modelId: string,
): Promise<HfModelInfo> {
  const res = await fetch(`${HF_API_URL}/models/${modelId}`, {
    headers: hfHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to get model info: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<HfModelInfo>;
}

// =============================================================================
// Download Model
// =============================================================================

async function handleDownloadModel(
  event: Electron.IpcMainInvokeEvent,
  params: { modelId: string; files?: string[] },
): Promise<{ path: string; files: string[] }> {
  const { modelId, files } = params;
  const token = getHfToken();

  // Get model metadata to know which files to download
  const modelInfo = await handleModelInfo(event, modelId);
  const siblings = modelInfo.siblings || [];

  // If specific files are requested, download only those; otherwise download all
  const filesToDownload = files
    ? siblings.filter((s) => files.includes(s.rfilename))
    : siblings;

  if (filesToDownload.length === 0) {
    throw new Error("No files found to download for this model.");
  }

  const modelDir = path.join(getModelsDir(), modelId.replace("/", "--"));
  await fs.mkdir(modelDir, { recursive: true });

  const downloadedFiles: string[] = [];
  const sender = event.sender;

  for (const file of filesToDownload) {
    const filePath = path.join(modelDir, file.rfilename);
    const fileDir = path.dirname(filePath);
    await fs.mkdir(fileDir, { recursive: true });

    // Skip if file already exists with correct size
    if (existsSync(filePath) && file.size) {
      const stat = await fs.stat(filePath);
      if (stat.size === file.size) {
        downloadedFiles.push(file.rfilename);
        continue;
      }
    }

    const url = `https://huggingface.co/${modelId}/resolve/main/${file.rfilename}`;
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      logger.warn(`Failed to download ${file.rfilename}: ${res.status}`);
      continue;
    }

    const total = Number(res.headers.get("content-length") || 0);
    let downloaded = 0;

    const body = res.body;
    if (!body) {
      throw new Error(`No response body for ${file.rfilename}`);
    }

    const writeStream = createWriteStream(filePath);
    const nodeStream = Readable.fromWeb(body as any);

    nodeStream.on("data", (chunk: Buffer) => {
      downloaded += chunk.length;
      try {
        sender.send("hf:download-progress", {
          modelId,
          file: file.rfilename,
          downloaded,
          total,
          percent: total > 0 ? Math.round((downloaded / total) * 100) : 0,
        } satisfies HfDownloadProgress);
      } catch {
        // sender may be destroyed
      }
    });

    await pipeline(nodeStream, writeStream);
    downloadedFiles.push(file.rfilename);
    logger.info(`Downloaded ${modelId}/${file.rfilename}`);
  }

  return { path: modelDir, files: downloadedFiles };
}

// =============================================================================
// Download Dataset
// =============================================================================

async function handleDownloadDataset(
  _: Electron.IpcMainInvokeEvent,
  params: { datasetId: string; split?: string },
): Promise<{ path: string }> {
  const { datasetId, split } = params;
  const token = getHfToken();

  // Download the parquet or json export
  const dsDir = path.join(getDatasetsDir(), datasetId.replace("/", "--"));
  await fs.mkdir(dsDir, { recursive: true });

  // Try to download the dataset viewer's first split
  const splitParam = split || "train";
  const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(datasetId)}&config=default&split=${splitParam}&offset=0&length=100`;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch dataset: ${res.status}`);
  }

  const data = await res.json();
  const outputPath = path.join(dsDir, `${splitParam}.json`);
  await fs.writeFile(outputPath, JSON.stringify(data, null, 2), "utf-8");

  logger.info(`Downloaded dataset ${datasetId} split=${splitParam} to ${outputPath}`);
  return { path: outputPath };
}

// =============================================================================
// Push Adapter to HuggingFace Hub
// =============================================================================

async function handlePushAdapter(
  _: Electron.IpcMainInvokeEvent,
  params: { adapterPath: string; repoId: string; commitMessage?: string },
): Promise<{ url: string }> {
  const { adapterPath, repoId, commitMessage = "Upload adapter via JoyCreate" } = params;
  const token = getHfToken();
  if (!token) {
    throw new Error("HuggingFace token is required to push models. Add it in Settings.");
  }

  // Ensure the repo exists (create if not)
  const createRes = await fetch(`${HF_API_URL}/repos/create`, {
    method: "POST",
    headers: {
      ...hfHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "model",
      name: repoId.split("/").pop(),
      organization: repoId.includes("/") ? repoId.split("/")[0] : undefined,
      private: false,
    }),
  });

  // 409 = already exists, which is fine
  if (!createRes.ok && createRes.status !== 409) {
    const errText = await createRes.text();
    throw new Error(`Failed to create HF repo: ${createRes.status} ${errText}`);
  }

  // Upload each file in the adapter directory
  const files = await fs.readdir(adapterPath, { recursive: true, withFileTypes: false }) as string[];
  
  for (const relFile of files) {
    const fullPath = path.join(adapterPath, relFile);
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) continue;

    const content = await fs.readFile(fullPath);
    const uploadUrl = `${HF_API_URL}/repos/${repoId}/upload/main/${relFile.replace(/\\/g, "/")}`;
    
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
      },
      body: content,
    });

    if (!uploadRes.ok) {
      logger.warn(`Failed to upload ${relFile}: ${uploadRes.status}`);
    } else {
      logger.info(`Uploaded ${relFile} to ${repoId}`);
    }
  }

  return { url: `https://huggingface.co/${repoId}` };
}

// =============================================================================
// Auth Status
// =============================================================================

async function handleAuthStatus(): Promise<{
  authenticated: boolean;
  username?: string;
}> {
  const token = getHfToken();
  if (!token) return { authenticated: false };

  try {
    const res = await fetch("https://huggingface.co/api/whoami-v2", {
      headers: hfHeaders(token),
    });
    if (!res.ok) return { authenticated: false };
    const data = (await res.json()) as { name?: string };
    return { authenticated: true, username: data.name };
  } catch {
    return { authenticated: false };
  }
}

// =============================================================================
// Registration
// =============================================================================

export function registerHuggingFaceHandlers() {
  ipcMain.handle("hf:search-models", handleSearchModels);
  ipcMain.handle("hf:search-datasets", handleSearchDatasets);
  ipcMain.handle("hf:model-info", handleModelInfo);
  ipcMain.handle("hf:download-model", handleDownloadModel);
  ipcMain.handle("hf:download-dataset", handleDownloadDataset);
  ipcMain.handle("hf:push-adapter", handlePushAdapter);
  ipcMain.handle("hf:auth-status", handleAuthStatus);
}
