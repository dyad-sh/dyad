import { readSettings } from "@/main/settings";
import { normalizePath } from "../../../shared/normalizePath";
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import log from "electron-log";
import { IS_TEST_BUILD } from "./test_utils";
import { z } from "zod";
import { gitIsIgnoredIso } from "./git_utils";

const logger = log.scope("cloud_sandbox_provider");

const DYAD_ENGINE_URL =
  process.env.DYAD_ENGINE_URL ?? "https://engine.dyad.sh/v1";
const CLOUD_SANDBOX_EXCLUDED_DIRS = new Set(["node_modules", ".git", ".next"]);
const CLOUD_SANDBOX_ROOT_ALLOWLIST = new Set([".env", ".env.local"]);

type CloudSandboxFileBytes = Uint8Array;

export type CloudSandboxFileMap = Record<string, CloudSandboxFileBytes>;
export type CloudSandboxSyncUpdate = {
  appId: number;
  errorMessage: string | null;
};

type CloudSandboxUploadManifest = {
  replaceAll: boolean;
  deletedFiles: string[];
  files: Array<{
    path: string;
    fieldName: string;
  }>;
};

const CloudSandboxCreateResponseSchema = z.object({
  sandboxId: z.string().trim().min(1),
  previewUrl: z.string().trim().min(1),
  previewAuthToken: z.string().trim().min(1),
});

const CloudSandboxUploadFilesResponseSchema = z.object({
  previewUrl: z.string().trim().min(1).optional(),
  previewAuthToken: z.string().trim().min(1).optional(),
});

const CloudSandboxRestartResponseSchema = z.object({
  previewUrl: z.string().trim().min(1),
  previewAuthToken: z.string().trim().min(1),
});

const CloudSandboxReconcileResponseSchema = z.object({
  reconciledSandboxIds: z.array(z.string().trim().min(1)).optional(),
});

const CloudSandboxStatusSchema = z.object({
  sandboxId: z.string().trim().min(1),
  status: z.string().trim().min(1),
  previewUrl: z.string().trim().min(1),
  previewAuthToken: z.string().trim().min(1),
  previewPort: z.number().int(),
  syncRevision: z.number().int().nonnegative(),
  initialSyncCompleted: z.boolean(),
  appStatus: z.enum(["starting", "running", "standby", "failed"]),
  syncAgentHealthy: z.boolean(),
  createdAt: z.string().trim().min(1),
  lastActiveAt: z.string().trim().min(1),
  lastSuccessfulSyncAt: z.string().trim().min(1).nullable(),
  expiresAt: z.string().trim().min(1),
  billingState: z.enum([
    "active",
    "charging",
    "terminated",
    "billing_unavailable",
  ]),
  billingStartedAt: z.string().trim().min(1),
  billingLockedAt: z.string().trim().min(1).nullable(),
  lastChargedAt: z.string().trim().min(1).nullable(),
  nextChargeAt: z.string().trim().min(1),
  billingSlicesCharged: z.number().int().nonnegative(),
  creditsCharged: z.number().nonnegative(),
  terminationReason: z
    .enum([
      "manual",
      "idle_timeout",
      "credits_exhausted",
      "billing_unavailable",
    ])
    .nullable(),
  lastErrorCode: z.string().trim().min(1).nullable(),
  lastErrorMessage: z.string().trim().min(1).nullable(),
  localSyncErrorMessage: z.string().trim().min(1).nullable().optional(),
});

const CloudSandboxShareLinkSchema = z.object({
  sandboxId: z.string().trim().min(1),
  shareLinkId: z.string().trim().min(1),
  url: z.string().trim().min(1),
  expiresAt: z.string().trim().min(1),
});

const ServiceResponseSchema = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({
    success: z.boolean(),
    message: z.string(),
    responseObject: schema.optional(),
    statusCode: z.number(),
  });

export type CloudSandboxStatus = z.infer<typeof CloudSandboxStatusSchema>;
export type CloudSandboxShareLink = z.infer<typeof CloudSandboxShareLinkSchema>;

export class CloudSandboxApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CloudSandboxApiError";
  }
}

type ActiveCloudSandbox = {
  appId: number;
  appPath: string;
  sandboxId: string;
  previewAuthToken?: string;
};

function getDefaultInstallCommand(): string {
  return "pnpm install";
}

function getDefaultStartCommand(): string {
  return "pnpm run dev";
}

function getDefaultCloudSandboxErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Dyad couldn’t authorize the cloud sandbox request. Please try again.";
  }

  if (status === 404) {
    return "The cloud sandbox could not be found.";
  }

  if (status === 429) {
    return "Dyad is rate limiting cloud sandbox requests right now. Please try again.";
  }

  if (status >= 500) {
    return "Dyad’s cloud sandbox service is temporarily unavailable. Please try again.";
  }

  return `Cloud sandbox request failed with ${status}.`;
}

function resolveCloudSandboxCommands(input: {
  appId: number;
  installCommand?: string | null;
  startCommand?: string | null;
}): { installCommand: string; startCommand: string } {
  return {
    installCommand: input.installCommand?.trim() || getDefaultInstallCommand(),
    startCommand: input.startCommand?.trim() || getDefaultStartCommand(),
  };
}

export interface CloudSandboxProvider {
  name: string;
  createSandbox(input: {
    appId: number;
    appPath: string;
    installCommand?: string | null;
    startCommand?: string | null;
  }): Promise<{
    sandboxId: string;
    previewUrl: string;
    previewAuthToken: string;
  }>;
  destroySandbox(sandboxId: string): Promise<void>;
  streamLogs(sandboxId: string, signal?: AbortSignal): AsyncIterable<string>;
  uploadFiles(
    sandboxId: string,
    files: CloudSandboxFileMap,
    options?: { replaceAll?: boolean; deletedFiles?: string[] },
  ): Promise<{ previewUrl?: string; previewAuthToken?: string }>;
  restartSandbox(
    sandboxId: string,
  ): Promise<{ previewUrl: string; previewAuthToken: string }>;
  getStatus(sandboxId: string): Promise<CloudSandboxStatus>;
  createShareLink(
    sandboxId: string,
    options?: { expiresInSeconds?: number },
  ): Promise<CloudSandboxShareLink>;
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
let cloudSandboxSyncUpdateListener:
  | ((update: CloudSandboxSyncUpdate) => void)
  | undefined;

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
  const isMultipartBody =
    typeof FormData !== "undefined" && init.body instanceof FormData;

  if (!headers.has("Content-Type") && init.body && !isMultipartBody) {
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
    const errorText = await response.text();
    let message = getDefaultCloudSandboxErrorMessage(response.status);
    let code: string | undefined;
    try {
      const parsed = JSON.parse(errorText) as {
        code?: string;
        message?: string;
      };
      message = parsed.message || message;
      code = parsed.code;
    } catch {
      // Keep the generic status-based message instead of surfacing raw HTML/JSON.
    }
    throw new CloudSandboxApiError(message, code, response.status);
  }

  return response;
}

async function parseServiceResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
  context: string,
): Promise<T> {
  const parsed = await response.json();
  const result = ServiceResponseSchema(schema).safeParse(parsed);

  if (!result.success || !result.data.responseObject) {
    throw new Error(
      `Invalid ${context} response from cloud sandbox API: ${
        result.success ? "Missing responseObject" : result.error.message
      }`,
    );
  }

  return result.data.responseObject;
}

async function parseResponseJson<T>(
  response: Response,
  schema: z.ZodType<T>,
  context: string,
): Promise<T> {
  const parsed = await response.json();
  const result = schema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Invalid ${context} response from cloud sandbox API: ${result.error.message}`,
    );
  }

  return result.data;
}

function buildCloudSandboxUploadFormData(input: {
  files: CloudSandboxFileMap;
  replaceAll: boolean;
  deletedFiles: string[];
}): FormData {
  const formData = new FormData();
  const manifest: CloudSandboxUploadManifest = {
    replaceAll: input.replaceAll,
    deletedFiles: input.deletedFiles,
    files: [],
  };
  const sortedFiles = Object.entries(input.files).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  for (const [filePath, content] of sortedFiles) {
    const fieldName = `file_${manifest.files.length}`;
    manifest.files.push({
      path: filePath,
      fieldName,
    });
    formData.append(
      fieldName,
      new Blob([Uint8Array.from(content)], {
        type: "application/octet-stream",
      }),
      path.posix.basename(filePath) || fieldName,
    );
  }

  formData.append("manifest", JSON.stringify(manifest));
  return formData;
}

export async function buildCloudSandboxFileMap(
  appPath: string,
): Promise<CloudSandboxFileMap> {
  const files = (await collectCloudSandboxFiles(appPath, appPath)).sort();
  const entries = await Promise.all(
    files.map(async (relativePath) => {
      const normalizedPath = normalizePath(relativePath);
      const fullPath = path.join(appPath, normalizedPath);
      const content = await fsPromises.readFile(fullPath);
      return [normalizedPath, content] as const;
    }),
  );

  return Object.fromEntries(entries);
}

function isRootCloudSandboxAllowlisted(relativePath: string): boolean {
  return CLOUD_SANDBOX_ROOT_ALLOWLIST.has(normalizePath(relativePath));
}

function hasCloudSandboxExcludedSegment(relativePath: string): boolean {
  return normalizePath(relativePath)
    .split("/")
    .some((segment) => CLOUD_SANDBOX_EXCLUDED_DIRS.has(segment));
}

function shouldForceCloudSandboxFullSyncForPath(relativePath: string): boolean {
  return path.posix.basename(normalizePath(relativePath)) === ".gitignore";
}

function shouldForceCloudSandboxFullSync(input: {
  changedPaths?: Iterable<string>;
  deletedPaths?: Iterable<string>;
}): boolean {
  for (const relativePath of input.changedPaths ?? []) {
    if (shouldForceCloudSandboxFullSyncForPath(relativePath)) {
      return true;
    }
  }

  for (const relativePath of input.deletedPaths ?? []) {
    if (shouldForceCloudSandboxFullSyncForPath(relativePath)) {
      return true;
    }
  }

  return false;
}

async function isCloudSandboxGitIgnored(
  appPath: string,
  relativePath: string,
): Promise<boolean> {
  try {
    return await gitIsIgnoredIso({
      path: appPath,
      filepath: normalizePath(relativePath),
    });
  } catch (error) {
    logger.warn(
      `Failed to evaluate gitignore rules for cloud sandbox path ${relativePath}:`,
      error,
    );
    return false;
  }
}

async function shouldIncludeCloudSandboxPath(
  appPath: string,
  relativePath: string,
): Promise<boolean> {
  const normalizedPath = normalizePath(relativePath);

  if (isRootCloudSandboxAllowlisted(normalizedPath)) {
    return true;
  }

  if (hasCloudSandboxExcludedSegment(normalizedPath)) {
    return false;
  }

  return !(await isCloudSandboxGitIgnored(appPath, normalizedPath));
}

async function collectCloudSandboxFiles(
  dir: string,
  appPath: string,
): Promise<string[]> {
  let entries;

  try {
    entries = await fsPromises.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      const relativePath = normalizePath(path.relative(appPath, fullPath));

      if (entry.isSymbolicLink()) {
        return [];
      }

      if (entry.isDirectory()) {
        if (CLOUD_SANDBOX_EXCLUDED_DIRS.has(entry.name)) {
          return [];
        }

        if (!(await shouldIncludeCloudSandboxPath(appPath, relativePath))) {
          return [];
        }

        return collectCloudSandboxFiles(fullPath, appPath);
      }

      if (!entry.isFile()) {
        return [];
      }

      if (!(await shouldIncludeCloudSandboxPath(appPath, relativePath))) {
        return [];
      }

      return [relativePath];
    }),
  );

  return nestedFiles.flat();
}

async function buildCloudSandboxPartialFileMap(input: {
  appPath: string;
  changedPaths: Iterable<string>;
}): Promise<{ files: CloudSandboxFileMap; deletedFiles: string[] }> {
  const files: CloudSandboxFileMap = {};
  const deletedFiles = new Set<string>();

  for (const relativePath of input.changedPaths) {
    const normalizedPath = normalizePath(relativePath);
    const fullPath = path.join(input.appPath, normalizedPath);

    try {
      const stats = await fsPromises.lstat(fullPath);

      if (stats.isSymbolicLink() || !stats.isFile()) {
        deletedFiles.add(normalizedPath);
        continue;
      }

      if (
        hasCloudSandboxExcludedSegment(normalizedPath) ||
        !(await shouldIncludeCloudSandboxPath(input.appPath, normalizedPath))
      ) {
        deletedFiles.add(normalizedPath);
        continue;
      }

      const content = await fsPromises.readFile(fullPath);
      files[normalizedPath] = content;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        deletedFiles.add(normalizedPath);
        continue;
      }
      throw error;
    }
  }

  return {
    files,
    deletedFiles: [...deletedFiles].sort(),
  };
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
  notifyCloudSandboxSyncUpdate({
    appId: activeSandbox.appId,
    errorMessage: null,
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
  notifyCloudSandboxSyncUpdate({
    appId: input.activeSandbox.appId,
    errorMessage: null,
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

  try {
    stopCloudSandboxFileSync(activeSandbox.appId);
    await uploadFullSnapshot(activeSandbox);
    logger.info(
      `Synced full app snapshot to cloud sandbox ${activeSandbox.sandboxId} for app ${activeSandbox.appId}.`,
    );
  } catch (error) {
    notifyCloudSandboxSyncUpdate({
      appId: activeSandbox.appId,
      errorMessage: formatCloudSandboxSyncError(error),
    });
    throw error;
  }
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

  const changedPaths = new Set(
    (input.changedPaths ?? []).map((changedPath) => normalizePath(changedPath)),
  );
  const deletedPaths = new Set(
    (input.deletedPaths ?? []).map((deletedPath) => normalizePath(deletedPath)),
  );

  try {
    stopCloudSandboxFileSync(activeSandbox.appId);
    await uploadPendingSnapshot({
      activeSandbox,
      changedPaths,
      deletedPaths,
      fullSync: shouldForceCloudSandboxFullSync({ changedPaths, deletedPaths }),
    });
  } catch (error) {
    notifyCloudSandboxSyncUpdate({
      appId: activeSandbox.appId,
      errorMessage: formatCloudSandboxSyncError(error),
    });
    throw error;
  }
}

class DyadEngineCloudSandboxProvider implements CloudSandboxProvider {
  name = "dyad-engine";

  async createSandbox(input: {
    appId: number;
    appPath: string;
    installCommand?: string | null;
    startCommand?: string | null;
  }) {
    const { installCommand, startCommand } = resolveCloudSandboxCommands(input);
    const response = await cloudSandboxFetch("/sandboxes", {
      method: "POST",
      body: JSON.stringify({
        appId: input.appId,
        appPath: input.appPath,
        installCommand,
        startCommand,
      }),
    });

    return parseResponseJson(
      response,
      CloudSandboxCreateResponseSchema,
      "create sandbox",
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
      body: buildCloudSandboxUploadFormData({
        files,
        replaceAll: options?.replaceAll ?? false,
        deletedFiles: options?.deletedFiles ?? [],
      }),
    });

    return parseResponseJson(
      response,
      CloudSandboxUploadFilesResponseSchema,
      "upload sandbox files",
    );
  }

  async restartSandbox(sandboxId: string) {
    const response = await cloudSandboxFetch(
      `/sandboxes/${sandboxId}/restart`,
      {
        method: "POST",
      },
    );

    return parseResponseJson(
      response,
      CloudSandboxRestartResponseSchema,
      "restart sandbox",
    );
  }

  async getStatus(sandboxId: string) {
    const response = await cloudSandboxFetch(`/sandboxes/${sandboxId}/status`);
    return parseServiceResponse(
      response,
      CloudSandboxStatusSchema,
      "cloud sandbox status",
    );
  }

  async createShareLink(
    sandboxId: string,
    options?: { expiresInSeconds?: number },
  ) {
    const response = await cloudSandboxFetch(
      `/sandboxes/${sandboxId}/share-links`,
      {
        method: "POST",
        body: JSON.stringify({
          expiresInSeconds: options?.expiresInSeconds,
        }),
      },
    );
    return parseServiceResponse(
      response,
      CloudSandboxShareLinkSchema,
      "cloud sandbox share link",
    );
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

export async function restartCloudSandbox(sandboxId: string) {
  return defaultProvider.restartSandbox(sandboxId);
}

export function streamCloudSandboxLogs(
  sandboxId: string,
  signal?: AbortSignal,
) {
  return defaultProvider.streamLogs(sandboxId, signal);
}

export async function getCloudSandboxStatus(
  sandboxId: string,
): Promise<CloudSandboxStatus> {
  return defaultProvider.getStatus(sandboxId);
}

export async function createCloudSandboxShareLink(
  sandboxId: string,
  options?: { expiresInSeconds?: number },
): Promise<CloudSandboxShareLink> {
  return defaultProvider.createShareLink(sandboxId, options);
}

export function setCloudSandboxSyncUpdateListener(
  listener?: (update: CloudSandboxSyncUpdate) => void,
): void {
  cloudSandboxSyncUpdateListener = listener;
}

function notifyCloudSandboxSyncUpdate(update: CloudSandboxSyncUpdate): void {
  cloudSandboxSyncUpdateListener?.(update);
}

function formatCloudSandboxSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Cloud sandbox sync failed: ${message}`;
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

  const fullSync =
    input.fullSync === true ||
    existing?.fullSync === true ||
    shouldForceCloudSandboxFullSync({
      changedPaths,
      deletedPaths,
    });

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
          await uploadPendingSnapshot({
            activeSandbox: pending.activeSandbox,
            changedPaths: pending.changedPaths,
            deletedPaths: pending.deletedPaths,
            fullSync: false,
          });
        }
      } catch (error) {
        logger.error(
          `Failed to sync app snapshot to cloud sandbox ${activeSandbox.sandboxId} for app ${activeSandbox.appId}:`,
          error,
        );
        notifyCloudSandboxSyncUpdate({
          appId: pending.activeSandbox.appId,
          errorMessage: formatCloudSandboxSyncError(error),
        });
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
    const result = await parseResponseJson(
      response,
      CloudSandboxReconcileResponseSchema,
      "reconcile sandboxes",
    );
    return result.reconciledSandboxIds ?? [];
  } catch (error) {
    if (error instanceof CloudSandboxApiError && error.status === 404) {
      return [];
    }
    throw error;
  }
}
