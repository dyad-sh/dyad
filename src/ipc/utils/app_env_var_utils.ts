/**
 * DO NOT USE LOGGER HERE.
 * Environment variables are sensitive and should not be logged.
 */

import { getDyadAppPath } from "@/paths/paths";
import { EnvVar } from "@/ipc/types";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { queueCloudSandboxSnapshotSync } from "./cloud_sandbox_provider";

const logger = log.scope("app_env_var_utils");

export const ENV_FILE_NAME = ".env.local";

export function getEnvFilePath({ appPath }: { appPath: string }): string {
  return path.join(getDyadAppPath(appPath), ENV_FILE_NAME);
}

export async function updatePostgresUrlEnvVar({
  appPath,
  connectionUri,
}: {
  appPath: string;
  connectionUri: string;
}) {
  // Given the connection uri, update the env vars for POSTGRES_URL and DATABASE_URL
  const envVars = parseEnvFile(await readEnvFile({ appPath }));

  // Update both POSTGRES_URL and DATABASE_URL to keep them in sync
  for (const key of ["POSTGRES_URL", "DATABASE_URL"]) {
    const existingVar = envVars.find((envVar) => envVar.key === key);
    if (existingVar) {
      existingVar.value = connectionUri;
    } else {
      envVars.push({
        key,
        value: connectionUri,
      });
    }
  }

  const envFileContents = serializeEnvFile(envVars);
  await fs.promises.writeFile(getEnvFilePath({ appPath }), envFileContents);
  queueCloudSandboxSnapshotSync({
    appPath: getDyadAppPath(appPath),
    changedPaths: [ENV_FILE_NAME],
  });
}

export async function updateDbPushEnvVar({
  appPath,
  disabled,
}: {
  appPath: string;
  disabled: boolean;
}) {
  try {
    const envVars = await readEnvVarsOrEmpty({ appPath });

    // Update or add DYAD_DISABLE_DB_PUSH
    const existingVar = envVars.find(
      (envVar) => envVar.key === "DYAD_DISABLE_DB_PUSH",
    );
    if (existingVar) {
      existingVar.value = disabled ? "true" : "false";
    } else {
      envVars.push({
        key: "DYAD_DISABLE_DB_PUSH",
        value: disabled ? "true" : "false",
      });
    }

    const envFileContents = serializeEnvFile(envVars);
    await fs.promises.writeFile(getEnvFilePath({ appPath }), envFileContents);
    queueCloudSandboxSnapshotSync({
      appPath: getDyadAppPath(appPath),
      changedPaths: [ENV_FILE_NAME],
    });
  } catch (error) {
    logger.error(
      `Failed to update DB push environment variable for app ${appPath}: ${error}`,
    );
    throw error;
  }
}

export async function readPostgresUrlFromEnvFile({
  appPath,
}: {
  appPath: string;
}): Promise<string> {
  const contents = await readEnvFile({ appPath });
  const envVars = parseEnvFile(contents);
  const postgresUrl = envVars.find(
    (envVar) => envVar.key === "POSTGRES_URL",
  )?.value;
  if (!postgresUrl) {
    throw new DyadError(
      "POSTGRES_URL not found in .env.local",
      DyadErrorKind.NotFound,
    );
  }
  return postgresUrl;
}

export async function readEnvFile({
  appPath,
}: {
  appPath: string;
}): Promise<string> {
  return fs.promises.readFile(getEnvFilePath({ appPath }), "utf8");
}

export async function readEnvFileIfExists({
  appPath,
}: {
  appPath: string;
}): Promise<string | null> {
  try {
    return await readEnvFile({ appPath });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function readEnvVarsOrEmpty({
  appPath,
}: {
  appPath: string;
}): Promise<EnvVar[]> {
  const content = await readEnvFileIfExists({ appPath });
  return content ? parseEnvFile(content) : [];
}

// Helper function to parse .env.local file content
export function parseEnvFile(content: string): EnvVar[] {
  const envVars: EnvVar[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    // Parse key=value pairs
    const equalIndex = trimmedLine.indexOf("=");
    if (equalIndex > 0) {
      const key = trimmedLine.substring(0, equalIndex).trim();
      const value = trimmedLine.substring(equalIndex + 1).trim();

      // Handle quoted values with potential inline comments
      let cleanValue = value;
      if (value.startsWith('"')) {
        // Find the closing quote, handling escaped quotes
        let endQuoteIndex = -1;
        for (let i = 1; i < value.length; i++) {
          if (value[i] === '"' && value[i - 1] !== "\\") {
            endQuoteIndex = i;
            break;
          }
        }
        if (endQuoteIndex !== -1) {
          cleanValue = value.slice(1, endQuoteIndex);
          // Unescape escaped quotes
          cleanValue = cleanValue.replace(/\\"/g, '"');
        }
      } else if (value.startsWith("'")) {
        // Find the closing quote for single quotes
        const endQuoteIndex = value.indexOf("'", 1);
        if (endQuoteIndex !== -1) {
          cleanValue = value.slice(1, endQuoteIndex);
        }
      }
      // For unquoted values, keep everything as-is (including potential # symbols)

      envVars.push({ key, value: cleanValue });
    }
  }

  return envVars;
}

function upsertEnvVar(envVars: EnvVar[], key: string, value: string): void {
  const existing = envVars.find((envVar) => envVar.key === key);
  if (existing) {
    existing.value = value;
  } else {
    envVars.push({ key, value });
  }
}

/**
 * Generate a random cookie secret for Neon Auth session signing.
 */
export function generateCookieSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function updateNeonEnvVars({
  appPath,
  connectionUri,
  neonAuthBaseUrl,
  preserveExistingAuth = false,
}: {
  appPath: string;
  connectionUri: string;
  /** Auth base URL returned by the Neon Auth API */
  neonAuthBaseUrl?: string;
  /** Preserve existing auth vars when auth activation failed transiently. */
  preserveExistingAuth?: boolean;
}): Promise<void> {
  let envVars = await readEnvVarsOrEmpty({ appPath });

  upsertEnvVar(envVars, "DATABASE_URL", connectionUri);
  upsertEnvVar(envVars, "POSTGRES_URL", connectionUri);

  if (neonAuthBaseUrl) {
    const previousAuthUrl = envVars.find(
      (v) => v.key === "NEON_AUTH_BASE_URL",
    )?.value;
    upsertEnvVar(envVars, "NEON_AUTH_BASE_URL", neonAuthBaseUrl);
    // Regenerate the cookie secret when the auth URL changes (e.g. branch switch)
    // to prevent cross-branch session reuse, or generate one if absent
    const existingSecret = envVars.find(
      (v) => v.key === "NEON_AUTH_COOKIE_SECRET",
    );
    if (!existingSecret || previousAuthUrl !== neonAuthBaseUrl) {
      upsertEnvVar(envVars, "NEON_AUTH_COOKIE_SECRET", generateCookieSecret());
    }
  } else {
    // Auth activation failed or is not available on this branch —
    // remove stale auth env vars so the old branch's values don't linger.
    if (!preserveExistingAuth) {
      envVars = envVars.filter(
        (v) =>
          v.key !== "NEON_AUTH_BASE_URL" && v.key !== "NEON_AUTH_COOKIE_SECRET",
      );
    }
  }

  const envFileContents = serializeEnvFile(envVars);
  await fs.promises.writeFile(getEnvFilePath({ appPath }), envFileContents);
  queueCloudSandboxSnapshotSync({
    appPath: getDyadAppPath(appPath),
    changedPaths: [ENV_FILE_NAME],
  });
}

/** Keys that are unambiguously Neon-owned and always safe to remove. */
const NEON_ONLY_ENV_VAR_KEYS = [
  "NEON_AUTH_BASE_URL",
  "NEON_AUTH_COOKIE_SECRET",
];

/** Generic DB keys that should only be removed if their value looks Neon-owned. */
const GENERIC_DB_ENV_VAR_KEYS = ["DATABASE_URL", "POSTGRES_URL"];

export async function removeNeonEnvVars({
  appPath,
}: {
  appPath: string;
}): Promise<void> {
  const existingContent = await readEnvFileIfExists({ appPath });
  if (!existingContent) {
    return;
  }

  const envVars = parseEnvFile(existingContent);

  const filtered = envVars.filter((envVar) => {
    if (NEON_ONLY_ENV_VAR_KEYS.includes(envVar.key)) return false;
    if (
      GENERIC_DB_ENV_VAR_KEYS.includes(envVar.key) &&
      envVar.value.includes(".neon.tech")
    ) {
      return false;
    }
    return true;
  });

  const envFileContents = serializeEnvFile(filtered);
  await fs.promises.writeFile(getEnvFilePath({ appPath }), envFileContents);
  queueCloudSandboxSnapshotSync({
    appPath: getDyadAppPath(appPath),
    changedPaths: [ENV_FILE_NAME],
  });
}

// Helper function to serialize environment variables to .env.local format
export function serializeEnvFile(envVars: EnvVar[]): string {
  return envVars
    .map(({ key, value }) => {
      // Add quotes if value contains spaces or special characters
      const needsQuotes = /[\s#"'=&?]/.test(value);
      const quotedValue = needsQuotes
        ? `"${value.replace(/"/g, '\\"')}"`
        : value;
      return `${key}=${quotedValue}`;
    })
    .join("\n");
}
