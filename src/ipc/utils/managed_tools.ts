import fs from "node:fs";
import path from "node:path";
import { getUserDataPath } from "@/paths/paths";
import { getPathEnvKey } from "@/ipc/utils/path_env";

export const MANAGED_TOOLS_DIR = "managed-tools";

export function getManagedToolsDir(): string {
  return path.join(getUserDataPath(), MANAGED_TOOLS_DIR);
}

export function prependPathSegment(
  env: NodeJS.ProcessEnv,
  segment: string,
): NodeJS.ProcessEnv {
  const pathKey = getPathEnvKey(env);
  const currentPath = env[pathKey] ?? "";
  const matchesSegment = (value: string) =>
    process.platform === "win32"
      ? value.toLowerCase() === segment.toLowerCase()
      : value === segment;
  const pathSegments = currentPath
    .split(path.delimiter)
    .filter((value) => value.length > 0);

  if (pathSegments.length > 0 && matchesSegment(pathSegments[0])) {
    return env;
  }

  return {
    ...env,
    [pathKey]: [
      segment,
      ...pathSegments.filter((value) => !matchesSegment(value)),
    ].join(path.delimiter),
  };
}

function expandWindowsEnvVars(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/g, (_match, key: string) => {
    const envKey = Object.keys(env).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    );
    return envKey ? (env[envKey] ?? "") : `%${key}%`;
  });
}

function normalizePathSegmentForExistenceCheck(
  segment: string,
  env: NodeJS.ProcessEnv,
): string | null {
  const trimmed = segment.trim().replace(/^"|"$/g, "");
  if (!trimmed) {
    return null;
  }
  if (process.platform === "win32") {
    const expanded = expandWindowsEnvVars(trimmed, env);
    if (expanded.includes("%")) {
      return null;
    }
    return expanded;
  }
  if (trimmed.startsWith("$")) {
    return null;
  }
  return trimmed.replace(/^~(?=$|[/\\])/, process.env.HOME ?? "~");
}

export function sanitizePathEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const pathKey = getPathEnvKey(env);
  const currentPath = env[pathKey];
  if (!currentPath) {
    return env;
  }

  const pathSegments = currentPath.split(path.delimiter);
  const existingSegments = pathSegments.filter((segment) => {
    const pathToCheck = normalizePathSegmentForExistenceCheck(segment, env);
    if (!pathToCheck) {
      return true;
    }
    return fs.existsSync(pathToCheck);
  });

  if (existingSegments.length === pathSegments.length) {
    return env;
  }

  return {
    ...env,
    [pathKey]: existingSegments.join(path.delimiter),
  };
}
