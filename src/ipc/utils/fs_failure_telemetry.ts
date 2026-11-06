import os from "node:os";
import log from "electron-log";
import { getDyadAppsBaseDirectory, getUserDataPath } from "@/paths/paths";
import { sendTelemetryEvent } from "./telemetry";

const logger = log.scope("fs_failure_telemetry");

/** Where in Dyad a filesystem operation failed. */
export type FsFailureFlow =
  | "chat_stream"
  | "local_agent"
  | "agent_tool"
  | "apply_edits"
  | "app_delete"
  | "pnpm_install"
  | "workspace_cleanup";

export type FsPathLocation =
  | "app"
  | "user_data"
  | "temp"
  | "program_files"
  | "home"
  | "other";

export type FsFileCategory =
  | "node_modules"
  | "git"
  | "build_output"
  | "gitignore"
  | "lockfile"
  | "package_json"
  | "env_file"
  | "source"
  | "other";

export interface FsPathRoots {
  /** The app the failure happened in, which may be outside the apps folder. */
  app?: string;
  apps?: string;
  userData?: string;
  temp?: string;
  home?: string;
}

const ERRNO_CODE = /^E[A-Z0-9]{1,15}$/;

// A filesystem call names one word ("open", "rename"). A failed spawn also
// carries a path, but its syscall is "spawn <command>", so it is left out.
// Network errors have an E-code too, but never a path.
const SYSCALL = /^[a-z_]{1,20}$/;

const BUILD_OUTPUT_DIRS = new Set([".next", ".vite", "dist"]);
const LOCKFILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);
const SOURCE_EXTENSIONS = new Set([
  "cjs",
  "css",
  "html",
  "js",
  "json",
  "jsx",
  "md",
  "mjs",
  "scss",
  "sql",
  "svg",
  "ts",
  "tsx",
  "vue",
]);

interface FsErrorFields {
  code: string;
  syscall: string;
  path: string;
}

/** The first error in the `cause` chain that came from a filesystem call. */
function findFsError(error: unknown): FsErrorFields | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current !== "object") return undefined;
    const { code, syscall, path, cause } = current as Record<string, unknown>;
    if (
      typeof code === "string" &&
      ERRNO_CODE.test(code) &&
      typeof syscall === "string" &&
      SYSCALL.test(syscall) &&
      typeof path === "string"
    ) {
      return { code, syscall, path };
    }
    current = cause;
  }
  return undefined;
}

function isWindowsPath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");
}

/** Forward slashes, no long-path prefix or trailing slash; lowercase on Windows. */
function normalizePath(p: string): string {
  let normalized = p.replace(/\\/g, "/").replace(/^\/\/\?\//, "");
  normalized = normalized.replace(/(?<!^)\/{2,}/g, "/").replace(/\/+$/, "");
  return isWindowsPath(p) ? normalized.toLowerCase() : normalized;
}

function isUnder(filePath: string, root: string | undefined): boolean {
  if (!root) return false;
  const normalizedRoot = normalizePath(root);
  if (!normalizedRoot) return false;
  return (
    filePath === normalizedRoot || filePath.startsWith(`${normalizedRoot}/`)
  );
}

/**
 * Sort a path into a fixed set of locations and file kinds, so a failure can
 * be traced to a file without sending the path itself.
 */
export function classifyFsPath(
  filePath: string,
  roots: FsPathRoots,
): {
  location: FsPathLocation;
  inOneDrive: boolean;
  fileCategory: FsFileCategory;
} {
  const normalized = normalizePath(filePath);
  const segments = normalized.split("/").filter(Boolean);
  const lowerSegments = segments.map((segment) => segment.toLowerCase());

  let location: FsPathLocation = "other";
  if (isUnder(normalized, roots.app) || isUnder(normalized, roots.apps))
    location = "app";
  else if (isUnder(normalized, roots.userData)) location = "user_data";
  else if (isUnder(normalized, roots.temp)) location = "temp";
  else if (
    lowerSegments.some((segment) => /^program files( \(x86\))?$/.test(segment))
  )
    location = "program_files";
  else if (isUnder(normalized, roots.home)) location = "home";

  // "OneDrive", "OneDrive - Contoso" on Windows; "OneDrive-Contoso" on macOS.
  const inOneDrive = lowerSegments.some((segment) =>
    /^onedrive($| - |-)/.test(segment),
  );

  const basename = lowerSegments.at(-1) ?? "";
  const extension = basename.includes(".")
    ? (basename.split(".").at(-1) ?? "")
    : "";
  let fileCategory: FsFileCategory = "other";
  if (lowerSegments.includes("node_modules")) fileCategory = "node_modules";
  else if (lowerSegments.includes(".git")) fileCategory = "git";
  else if (lowerSegments.some((segment) => BUILD_OUTPUT_DIRS.has(segment)))
    fileCategory = "build_output";
  else if (basename === ".gitignore") fileCategory = "gitignore";
  else if (LOCKFILES.has(basename)) fileCategory = "lockfile";
  else if (basename === "package.json") fileCategory = "package_json";
  else if (basename === ".env" || basename.startsWith(".env."))
    fileCategory = "env_file";
  else if (SOURCE_EXTENSIONS.has(extension)) fileCategory = "source";

  return { location, inOneDrive, fileCategory };
}

function tryGet(getter: () => string): string | undefined {
  try {
    return getter();
  } catch {
    return undefined;
  }
}

function currentRoots(appPath: string | undefined): FsPathRoots {
  return {
    app: appPath,
    apps: tryGet(getDyadAppsBaseDirectory),
    userData: tryGet(getUserDataPath),
    temp: tryGet(os.tmpdir),
    home: tryGet(os.homedir),
  };
}

/**
 * Send `fs:operation-failed` when `error` (or its `cause`) came from a
 * filesystem call. Only the error code, the call, and where the path falls
 * are sent, never the path. Other errors are ignored. Pass `appPath` where
 * the app is known, so an app outside the apps folder still counts as `app`.
 */
export function reportFsFailure(
  flow: FsFailureFlow,
  error: unknown,
  extra?: { tool?: string; appPath?: string },
): void {
  try {
    const fsError = findFsError(error);
    if (!fsError) return;
    const { location, inOneDrive, fileCategory } = classifyFsPath(
      fsError.path,
      currentRoots(extra?.appPath),
    );
    sendTelemetryEvent("fs:operation-failed", {
      flow,
      code: fsError.code,
      syscall: fsError.syscall,
      location,
      in_onedrive: inOneDrive,
      file_category: fileCategory,
      ...(extra?.tool ? { tool: extra.tool } : {}),
    });
  } catch (reportError) {
    logger.warn("Failed to report filesystem failure:", reportError);
  }
}
