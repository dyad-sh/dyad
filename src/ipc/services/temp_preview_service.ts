import { readFile } from "node:fs/promises";
import path from "node:path";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import type { TempPreviewStatus } from "@/ipc/types/temp_preview";
import { simpleSpawn } from "@/ipc/utils/simpleSpawn";
import {
  getPnpmMinimumReleaseAgeSupport,
  getPackageManagerCommandEnv,
} from "@/ipc/utils/socket_firewall";
import { choosePackageManagerForApp } from "@/ipc/utils/package_manager_selection";
import { encrypt, decrypt } from "@/main/settings";
import { getUserDataPath } from "@/paths/paths";
import { discoverTempPreviewBundle } from "@/temp_preview/bundle";
import {
  TempmdApiError,
  TempmdClient,
  type TempPreviewConnection,
} from "@/temp_preview/client";
import {
  getEffectiveTempPreviewExpiry,
  isTempPreviewExpired,
} from "@/temp_preview/expiry";
import {
  TempPreviewStore,
  TempPreviewStoreUnreadableError,
  type TempPreviewRecord,
} from "@/temp_preview/store";
import { safeTempPreviewErrorMessage } from "./temp_preview_safe_error";

const TEMP_PREVIEW_STORE_FILE = "temp-preview-connections.json";

function createStore(): TempPreviewStore {
  return new TempPreviewStore(
    path.join(getUserDataPath(), TEMP_PREVIEW_STORE_FILE),
    { encode: encrypt, decode: decrypt },
  );
}

function createClient(): TempmdClient {
  return new TempmdClient(process.env.TEMP_MD_API_URL);
}

export async function getTempPreviewStatus(
  appId: number,
): Promise<TempPreviewStatus> {
  try {
    return statusFromRecord(await createStore().read(appId));
  } catch (error) {
    throw classifyTempPreviewError(error);
  }
}

export async function publishTempPreview(input: {
  appId: number;
  appPath: string;
  appName: string;
}): Promise<TempPreviewStatus> {
  try {
    await assertBuildScript(input.appPath);
    const pnpmSupport = await getPnpmMinimumReleaseAgeSupport();
    const packageManager = choosePackageManagerForApp(
      input.appPath,
      pnpmSupport.available,
    );
    await simpleSpawn({
      command: `${packageManager} run build`,
      cwd: input.appPath,
      env: getPackageManagerCommandEnv(),
      successMessage: "Temporary preview build completed",
      errorPrefix: "Failed to build the temporary preview",
      // App-owned build output can contain secrets and local paths. Keep it in
      // the bounded failure result for classifyTempPreviewError to sanitize,
      // but do not persist the raw stream in application/debug-bundle logs.
      logOutput: false,
    });

    let files;
    try {
      files = await discoverTempPreviewBundle(path.join(input.appPath, "dist"));
    } catch (error) {
      throw new DyadError(
        error instanceof Error ? error.message : "The build output is invalid.",
        DyadErrorKind.Validation,
        { cause: error },
      );
    }

    const store = createStore();
    const previousRecord = await store.read(input.appId);
    const previous = activeConnection(previousRecord);
    const client = createClient();
    let published: TempPreviewConnection;
    try {
      published = await client.publish({
        files,
        title: input.appName,
        ...(previous ? { previous } : {}),
      });
    } catch (error) {
      if (!previous || !isStaleConnectionError(error, "session")) throw error;
      if (previousRecord) {
        await store.write(input.appId, {
          ...previousRecord,
          updateToken: undefined,
          state: "revoked",
        });
      }
      published = await client.publish({ files, title: input.appName });
    }
    const lastPublishedAt = new Date().toISOString();
    const record: TempPreviewRecord = {
      ...published,
      expiresAt: getEffectiveTempPreviewExpiry(
        published.expiresAt,
        lastPublishedAt,
      ),
      lastPublishedAt,
      state: "active",
    };
    try {
      await store.write(input.appId, record);
    } catch (error) {
      try {
        await client.revoke(published);
      } catch {
        // Best-effort cleanup: preserve the local persistence failure.
      }
      throw error;
    }
    return statusFromRecord(record);
  } catch (error) {
    throw classifyTempPreviewError(error);
  }
}

export async function revokeTempPreview(
  appId: number,
): Promise<TempPreviewStatus> {
  try {
    const store = createStore();
    const record = await store.read(appId);
    const connection = activeConnection(record);
    if (!record || !connection) {
      throw new DyadError(
        "This app does not have an active temporary preview to revoke.",
        DyadErrorKind.Precondition,
      );
    }
    try {
      await createClient().revoke(connection);
    } catch (error) {
      if (!isStaleConnectionError(error, "revoke")) throw error;
    }
    const revoked: TempPreviewRecord = {
      ...record,
      updateToken: undefined,
      state: "revoked",
    };
    await store.write(appId, revoked);
    return statusFromRecord(revoked);
  } catch (error) {
    throw classifyTempPreviewError(error);
  }
}

export async function deleteTempPreviewForApp(appId: number): Promise<void> {
  try {
    const store = createStore();
    const record = await store.read(appId);
    const connection = activeConnection(record);
    if (connection) {
      try {
        await createClient().revoke(connection);
      } catch (error) {
        if (!isStaleConnectionError(error, "revoke")) throw error;
      }
    }
    await store.remove(appId);
  } catch (error) {
    throw classifyTempPreviewError(error);
  }
}

export async function markTempPreviewForAppDeletion(
  appId: number,
): Promise<boolean> {
  try {
    return await createStore().markPendingDeletion(appId);
  } catch (error) {
    throw classifyTempPreviewError(error);
  }
}

export async function clearTempPreviewAppDeletionMarker(
  appId: number,
): Promise<void> {
  try {
    await createStore().clearPendingDeletion(appId);
  } catch (error) {
    throw classifyTempPreviewError(error);
  }
}

export async function listPendingTempPreviewDeletionAppIds(): Promise<
  number[]
> {
  try {
    return await createStore().listPendingDeletionAppIds();
  } catch (error) {
    throw classifyTempPreviewError(error);
  }
}

async function assertBuildScript(appPath: string): Promise<void> {
  let packageJson: unknown;
  try {
    packageJson = JSON.parse(
      await readFile(path.join(appPath, "package.json"), "utf8"),
    );
  } catch (error) {
    throw new DyadError(
      "Temporary previews require an app with a readable package.json.",
      DyadErrorKind.Precondition,
      { cause: error },
    );
  }
  const scripts =
    packageJson && typeof packageJson === "object"
      ? (packageJson as { scripts?: unknown }).scripts
      : undefined;
  if (
    !scripts ||
    typeof scripts !== "object" ||
    typeof (scripts as { build?: unknown }).build !== "string"
  ) {
    throw new DyadError(
      "Temporary previews require a package.json build script.",
      DyadErrorKind.Precondition,
    );
  }
}

function activeConnection(
  record: TempPreviewRecord | null,
): TempPreviewConnection | undefined {
  const expiresAt = record
    ? getEffectiveTempPreviewExpiry(record.expiresAt, record.lastPublishedAt)
    : null;
  if (
    !record ||
    record.state !== "active" ||
    !record.updateToken ||
    isTempPreviewExpired(record.expiresAt, record.lastPublishedAt)
  ) {
    return undefined;
  }
  return {
    tempId: record.tempId,
    canonicalUrl: record.canonicalUrl,
    updateToken: record.updateToken,
    expiresAt,
  };
}

function statusFromRecord(record: TempPreviewRecord | null): TempPreviewStatus {
  if (!record) {
    return {
      state: "none",
      canonicalUrl: null,
      expiresAt: null,
      lastPublishedAt: null,
    };
  }
  const expiresAt = getEffectiveTempPreviewExpiry(
    record.expiresAt,
    record.lastPublishedAt,
  );
  return {
    state:
      record.state === "active" &&
      isTempPreviewExpired(record.expiresAt, record.lastPublishedAt)
        ? "expired"
        : record.state,
    canonicalUrl: record.canonicalUrl,
    expiresAt,
    lastPublishedAt: record.lastPublishedAt,
  };
}

function isStaleConnectionError(
  error: unknown,
  phase: "session" | "revoke",
): boolean {
  return (
    error instanceof TempmdApiError &&
    error.phase === phase &&
    (error.status === 403 || error.status === 404 || error.status === 410)
  );
}

function classifyTempPreviewError(error: unknown): Error {
  if (isDyadError(error)) {
    return new DyadError(safeTempPreviewErrorMessage(error), error.kind);
  }
  if (error instanceof TempPreviewStoreUnreadableError) {
    return new DyadError(
      safeTempPreviewErrorMessage(error),
      DyadErrorKind.External,
    );
  }
  if (!(error instanceof TempmdApiError)) {
    return new DyadError(
      safeTempPreviewErrorMessage(error),
      DyadErrorKind.Unknown,
    );
  }
  let kind: DyadErrorKind;
  if (error.status === 400 || error.status === 413) {
    kind = DyadErrorKind.Validation;
  } else if (error.status === 401 || error.status === 403) {
    kind = DyadErrorKind.Auth;
  } else if (error.status === 404) {
    kind = DyadErrorKind.NotFound;
  } else if (error.status === 409) {
    kind = DyadErrorKind.Conflict;
  } else if (error.status === 410) {
    kind = DyadErrorKind.Precondition;
  } else if (error.status === 429) {
    kind = DyadErrorKind.RateLimited;
  } else {
    kind = DyadErrorKind.External;
  }
  return new DyadError(safeTempPreviewErrorMessage(error), kind);
}
