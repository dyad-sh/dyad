import { readSettings } from "@/main/settings";
import { getFilesRecursively } from "./file_utils";
import { normalizePath } from "../../../shared/normalizePath";
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import log from "electron-log";
import { IS_TEST_BUILD } from "./test_utils";

const logger = log.scope("cloud_sandbox_provider");

const DYAD_ENGINE_URL =
  process.env.DYAD_ENGINE_URL ?? "https://engine.dyad.sh/v1";

export type CloudSandboxFileMap = Record<string, string>;

type ActiveCloudSandbox = {
  appId: number;
  appPath: string;
  sandboxId: string;
};

export interface CloudSandboxProvider {
  name: string;
  createSandbox(input: {
    appId: number;
    appPath: string;
    installCommand?: string | null;
    startCommand?: string | null;
  }): Promise<{ sandboxId: string; previewUrl: string }>;
  destroySandbox(sandboxId: string): Promise<void>;
  streamLogs(sandboxId: string, signal?: AbortSignal): AsyncIterable<string>;
  uploadFiles(
    sandboxId: string,
    files: CloudSandboxFileMap,
    options?: { replaceAll?: boolean; deletedFiles?: string[] },
  ): Promise<{ previewUrl?: string }>;
}

const pendingUploads = new Map<
  number,
  {
    activeSandbox: ActiveCloudSandbox;
    timeoutId: ReturnType<typeof setTimeout>;
    changedPaths: Set<string>;
    deletedPaths: Set<string>;
    fullSync: boolean;
  }
>();
const activeCloudSandboxesByAppId = new Map<number, ActiveCloudSandbox>();
const activeCloudSandboxesByPath = new Map<string, ActiveCloudSandbox>();

function getDyadEngineApiKey() {
  const settings = readSettings();
  const apiKey = settings.providerSettings?.auto?.apiKey?.value;

  if (!apiKey && !IS_TEST_BUILD) {
    throw new Error("Dyad Pro API key is required for cloud sandboxes.");
  }

  return apiKey;
}

async function cloudSandboxFetch(
  endpoint: string,
  init: RequestInit = {},
): Promise<Response> {
  const apiKey = getDyadEngineApiKey();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (apiKey) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }

  const response = await fetch(`${DYAD_ENGINE_URL}${endpoint}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      errorBody || `Cloud sandbox request failed with ${response.status}.`,
    );
  }

  return response;
}

async function readResponseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function buildCloudSandboxFileMap(
  appPath: string,
): Promise<CloudSandboxFileMap> {
  const files = getFilesRecursively(appPath, appPath).sort();
  const entries = await Promise.all(
    files.map(async (relativePath) => {
      const normalizedPath = normalizePath(relativePath);
      const fullPath = path.join(appPath, normalizedPath);
      const content = await fsPromises.readFile(fullPath, "utf-8");
      return [normalizedPath, content] as const;
    }),
  );

  return Object.fromEntries(entries);
}

async function buildCloudSandboxPartialFileMap(input: {
  appPath: string;
  changedPaths: Iterable<string>;
}): Promise<{ files: CloudSandboxFileMap; deletedFiles: string[] }> {
  const files: CloudSandboxFileMap = {};
  const deletedFiles: string[] = [];

  for (const relativePath of input.changedPaths) {
    const normalizedPath = normalizePath(relativePath);
    const fullPath = path.join(input.appPath, normalizedPath);

    try {
      const content = await fsPromises.readFile(fullPath, "utf-8");
      files[normalizedPath] = content;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        deletedFiles.push(normalizedPath);
        continue;
      }
      throw error;
    }
  }

  return { files, deletedFiles };
}

async function* parseSseLines(response: Response, signal?: AbortSignal) {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (signal?.aborted) {
      await reader.cancel();
      return;
    }

    buffered += decoder.decode(value, { stream: true });

    while (buffered.includes("\n\n")) {
      const boundary = buffered.indexOf("\n\n");
      const rawEvent = buffered.slice(0, boundary);
      buffered = buffered.slice(boundary + 2);

      const dataLines = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());

      if (dataLines.length === 0) {
        continue;
      }

      const payload = dataLines.join("\n");
      if (payload === "[DONE]") {
        return;
      }

      yield payload;
    }
  }
}

function resolveActiveCloudSandbox(input: {
  appId?: number;
  appPath?: string;
}): ActiveCloudSandbox | undefined {
  return (
    (input.appId !== undefined
      ? activeCloudSandboxesByAppId.get(input.appId)
      : undefined) ??
    (input.appPath
      ? activeCloudSandboxesByPath.get(path.resolve(input.appPath))
      : undefined)
  );
}

async function uploadFullSnapshot(activeSandbox: ActiveCloudSandbox) {
  const files = await buildCloudSandboxFileMap(activeSandbox.appPath);
  await uploadCloudSandboxFiles({
    sandboxId: activeSandbox.sandboxId,
    files,
    replaceAll: true,
  });
}

async function uploadPendingSnapshot(input: {
  activeSandbox: ActiveCloudSandbox;
  changedPaths: Set<string>;
  deletedPaths: Set<string>;
  fullSync: boolean;
}) {
  if (input.fullSync) {
    await uploadFullSnapshot(input.activeSandbox);
    logger.info(
      `Synced full app snapshot to cloud sandbox ${input.activeSandbox.sandboxId} for app ${input.activeSandbox.appId}.`,
    );
    return;
  }

  const { files, deletedFiles: missingChangedFiles } =
    await buildCloudSandboxPartialFileMap({
      appPath: input.activeSandbox.appPath,
      changedPaths: input.changedPaths,
    });

  const deletedFiles = [
    ...new Set([...input.deletedPaths, ...missingChangedFiles]),
  ].sort();

  if (Object.keys(files).length === 0 && deletedFiles.length === 0) {
    return;
  }

  await uploadCloudSandboxFiles({
    sandboxId: input.activeSandbox.sandboxId,
    files,
    deletedFiles,
    replaceAll: false,
  });
  logger.info(
    `Synced incremental app snapshot to cloud sandbox ${input.activeSandbox.sandboxId} for app ${input.activeSandbox.appId}. fileCount=${Object.keys(files).length} deletedCount=${deletedFiles.length}.`,
  );
}

export async function syncCloudSandboxSnapshot(input: {
  appId?: number;
  appPath?: string;
}): Promise<void> {
  const activeSandbox = resolveActiveCloudSandbox(input);
  if (!activeSandbox) {
    return;
  }

  stopCloudSandboxFileSync(activeSandbox.appId);
  await uploadFullSnapshot(activeSandbox);
  logger.info(
    `Synced full app snapshot to cloud sandbox ${activeSandbox.sandboxId} for app ${activeSandbox.appId}.`,
  );
}

export async function syncCloudSandboxDirtyPaths(input: {
  appId?: number;
  appPath?: string;
  changedPaths?: string[];
  deletedPaths?: string[];
}): Promise<void> {
  const activeSandbox = resolveActiveCloudSandbox(input);
  if (!activeSandbox) {
    return;
  }

  stopCloudSandboxFileSync(activeSandbox.appId);
  await uploadPendingSnapshot({
    activeSandbox,
    changedPaths: new Set(
      (input.changedPaths ?? []).map((changedPath) =>
        normalizePath(changedPath),
      ),
    ),
    deletedPaths: new Set(
      (input.deletedPaths ?? []).map((deletedPath) =>
        normalizePath(deletedPath),
      ),
    ),
    fullSync: false,
  });
}

class DyadEngineCloudSandboxProvider implements CloudSandboxProvider {
  name = "dyad-engine";

  async createSandbox(input: {
    appId: number;
    appPath: string;
    installCommand?: string | null;
    startCommand?: string | null;
  }) {
    const response = await cloudSandboxFetch("/sandboxes", {
      method: "POST",
      body: JSON.stringify({
        appId: input.appId,
        appPath: input.appPath,
        installCommand: input.installCommand ?? null,
        startCommand: input.startCommand ?? null,
      }),
    });

    return readResponseJson<{ sandboxId: string; previewUrl: string }>(
      response,
    );
  }

  async destroySandbox(sandboxId: string) {
    await cloudSandboxFetch(`/sandboxes/${sandboxId}`, {
      method: "DELETE",
    });
  }

  async *streamLogs(sandboxId: string, signal?: AbortSignal) {
    const response = await cloudSandboxFetch(`/sandboxes/${sandboxId}/logs`, {
      headers: {
        Accept: "text/event-stream",
      },
      signal,
    });

    for await (const payload of parseSseLines(response, signal)) {
      try {
        const parsed = JSON.parse(payload) as { message?: string };
        yield parsed.message ?? payload;
      } catch {
        yield payload;
      }
    }
  }

  async uploadFiles(
    sandboxId: string,
    files: CloudSandboxFileMap,
    options?: { replaceAll?: boolean; deletedFiles?: string[] },
  ) {
    const response = await cloudSandboxFetch(`/sandboxes/${sandboxId}/files`, {
      method: "POST",
      body: JSON.stringify({
        files,
        replaceAll: options?.replaceAll ?? false,
        deletedFiles: options?.deletedFiles ?? [],
      }),
    });

    return readResponseJson<{ previewUrl?: string }>(response);
  }
}

const defaultProvider: CloudSandboxProvider =
  new DyadEngineCloudSandboxProvider();

export async function destroyCloudSandbox(sandboxId: string): Promise<void> {
  await defaultProvider.destroySandbox(sandboxId);
}

export async function createCloudSandbox(input: {
  appId: number;
  appPath: string;
  installCommand?: string | null;
  startCommand?: string | null;
}) {
  return defaultProvider.createSandbox(input);
}

export async function uploadCloudSandboxFiles(input: {
  sandboxId: string;
  files: CloudSandboxFileMap;
  replaceAll?: boolean;
  deletedFiles?: string[];
}) {
  return defaultProvider.uploadFiles(input.sandboxId, input.files, {
    replaceAll: input.replaceAll,
    deletedFiles: input.deletedFiles,
  });
}

export function streamCloudSandboxLogs(
  sandboxId: string,
  signal?: AbortSignal,
) {
  return defaultProvider.streamLogs(sandboxId, signal);
}

export function registerRunningCloudSandbox(input: ActiveCloudSandbox): void {
  const activeSandbox = {
    ...input,
    appPath: path.resolve(input.appPath),
  };
  activeCloudSandboxesByAppId.set(activeSandbox.appId, activeSandbox);
  activeCloudSandboxesByPath.set(activeSandbox.appPath, activeSandbox);
}

export function unregisterRunningCloudSandbox(input: {
  appId: number;
  appPath?: string;
}): void {
  const existing = activeCloudSandboxesByAppId.get(input.appId);
  if (existing) {
    activeCloudSandboxesByPath.delete(existing.appPath);
  }
  if (input.appPath) {
    activeCloudSandboxesByPath.delete(path.resolve(input.appPath));
  }
  activeCloudSandboxesByAppId.delete(input.appId);
}

export function stopCloudSandboxFileSync(appId: number): void {
  const pending = pendingUploads.get(appId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeoutId);
  pendingUploads.delete(appId);
}

export function queueCloudSandboxSnapshotSync(input: {
  appId?: number;
  appPath?: string;
  immediate?: boolean;
  changedPaths?: string[];
  deletedPaths?: string[];
  fullSync?: boolean;
}): void {
  const activeSandbox = resolveActiveCloudSandbox(input);
  if (!activeSandbox) {
    return;
  }

  const existing = pendingUploads.get(activeSandbox.appId);
  if (existing) {
    clearTimeout(existing.timeoutId);
  }

  const changedPaths = existing?.changedPaths ?? new Set<string>();
  const deletedPaths = existing?.deletedPaths ?? new Set<string>();

  for (const changedPath of input.changedPaths ?? []) {
    const normalizedPath = normalizePath(changedPath);
    changedPaths.add(normalizedPath);
    deletedPaths.delete(normalizedPath);
  }

  for (const deletedPath of input.deletedPaths ?? []) {
    const normalizedPath = normalizePath(deletedPath);
    deletedPaths.add(normalizedPath);
    changedPaths.delete(normalizedPath);
  }

  const fullSync = input.fullSync === true || existing?.fullSync === true;

  const timeoutId = setTimeout(
    async () => {
      const pending = pendingUploads.get(activeSandbox.appId);
      pendingUploads.delete(activeSandbox.appId);

      if (!pending) {
        return;
      }

      try {
        if (pending.fullSync) {
          await uploadPendingSnapshot({
            activeSandbox: pending.activeSandbox,
            changedPaths: pending.changedPaths,
            deletedPaths: pending.deletedPaths,
            fullSync: true,
          });
        } else {
          await syncCloudSandboxDirtyPaths({
            appId: pending.activeSandbox.appId,
            changedPaths: [...pending.changedPaths],
            deletedPaths: [...pending.deletedPaths],
          });
        }
      } catch (error) {
        logger.error(
          `Failed to sync app snapshot to cloud sandbox ${activeSandbox.sandboxId} for app ${activeSandbox.appId}:`,
          error,
        );
      }
    },
    input.immediate ? 0 : 300,
  );

  pendingUploads.set(activeSandbox.appId, {
    activeSandbox,
    timeoutId,
    changedPaths,
    deletedPaths,
    fullSync,
  });
}

export async function reconcileCloudSandboxes(): Promise<string[]> {
  try {
    const response = await cloudSandboxFetch("/sandboxes/reconcile", {
      method: "POST",
    });
    const result = await readResponseJson<{
      reconciledSandboxIds?: string[];
    }>(response);
    return result.reconciledSandboxIds ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("404") ||
      message.includes("Cannot POST /sandboxes/reconcile")
    ) {
      return [];
    }
    throw error;
  }
}
