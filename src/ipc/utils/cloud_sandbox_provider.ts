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
    options?: { replaceAll?: boolean },
  ): Promise<{ previewUrl?: string }>;
}

const pendingUploads = new Map<
  number,
  {
    activeSandbox: ActiveCloudSandbox;
    timeoutId: ReturnType<typeof setTimeout>;
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
    options?: { replaceAll?: boolean },
  ) {
    const response = await cloudSandboxFetch(`/sandboxes/${sandboxId}/files`, {
      method: "POST",
      body: JSON.stringify({
        files,
        replaceAll: options?.replaceAll ?? false,
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
}) {
  return defaultProvider.uploadFiles(input.sandboxId, input.files, {
    replaceAll: input.replaceAll,
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
}): void {
  const activeSandbox = resolveActiveCloudSandbox(input);
  if (!activeSandbox) {
    return;
  }

  const existing = pendingUploads.get(activeSandbox.appId);
  if (existing) {
    clearTimeout(existing.timeoutId);
  }

  const timeoutId = setTimeout(
    async () => {
      pendingUploads.delete(activeSandbox.appId);

      try {
        await syncCloudSandboxSnapshot({
          appId: activeSandbox.appId,
        });
      } catch (error) {
        logger.error(
          `Failed to sync full app snapshot to cloud sandbox ${activeSandbox.sandboxId} for app ${activeSandbox.appId}:`,
          error,
        );
      }
    },
    input.immediate ? 0 : 300,
  );

  pendingUploads.set(activeSandbox.appId, {
    activeSandbox,
    timeoutId,
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
