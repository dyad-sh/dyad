import { spawnSync } from "child_process";
import path from "path";
import log from "electron-log";

const logger = log.scope("windows_env_path");

const REG_MACHINE_ENV_KEY =
  "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment";
const REG_USER_ENV_KEY = "HKCU\\Environment";

function getSystemRoot(): string {
  return process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
}

function runWindowsCommand(executable: string, args: string[]): string | null {
  // No shell, absolute executable path: a corrupted PATH entry must not be
  // able to break the PATH refresh itself with a spawn ENOENT.
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5_000,
  });
  if (result.error) {
    logger.warn(`Failed to run ${executable}:`, result.error.message);
    return null;
  }
  if (result.status !== 0) {
    logger.warn(`${executable} exited with status ${result.status}`);
    return null;
  }
  return result.stdout ?? null;
}

function readPathViaPowerShell(): string | null {
  const powershell = path.join(
    getSystemRoot(),
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const stdout = runWindowsCommand(powershell, [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    // The .NET API reads the registry directly and expands REG_EXPAND_SZ
    // values (%SystemRoot% etc.) the same way a freshly launched process
    // would see them.
    "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')",
  ]);
  const value = stdout?.trim().replace(/^;+|;+$/g, "");
  return value ? value : null;
}

export function parseRegQueryPathOutput(output: string | null): string | null {
  if (!output) {
    return null;
  }
  const match = output.match(/^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.+)$/im);
  if (!match) {
    return null;
  }
  const value = match[1].trim();
  return value ? value : null;
}

export function expandWindowsEnvVars(
  value: string,
  env: Record<string, string | undefined>,
): string {
  const lookup = new Map<string, string>();
  for (const [key, envValue] of Object.entries(env)) {
    if (envValue !== undefined) {
      lookup.set(key.toLowerCase(), envValue);
    }
  }
  // Leave unknown %VAR% references untouched, matching cmd.exe behavior.
  return value.replace(/%([^%;]+)%/g, (reference, name: string) => {
    return lookup.get(name.toLowerCase()) ?? reference;
  });
}

function readPathViaRegQuery(): string | null {
  const reg = path.join(getSystemRoot(), "System32", "reg.exe");
  const machine = parseRegQueryPathOutput(
    runWindowsCommand(reg, ["query", REG_MACHINE_ENV_KEY, "/v", "Path"]),
  );
  // The user-scope Path value may legitimately not exist.
  const user = parseRegQueryPathOutput(
    runWindowsCommand(reg, ["query", REG_USER_ENV_KEY, "/v", "Path"]),
  );
  if (machine === null && user === null) {
    return null;
  }
  const combined = [machine, user]
    .filter((value): value is string => Boolean(value))
    .join(";");
  return expandWindowsEnvVars(combined, process.env);
}

function normalizePathSegment(segment: string): string {
  let normalized = segment.toLowerCase();
  while (
    normalized.length > 3 &&
    (normalized.endsWith("\\") || normalized.endsWith("/"))
  ) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function mergeWindowsPathSegments(
  currentPath: string,
  registryPath: string,
): string {
  // Keep true session-only additions first (e.g. a version manager's env from
  // the shell that launched Dyad), then use the freshly read registry ordering
  // for every registry-known entry. This preserves Windows machine-before-user
  // precedence when a new machine PATH entry appears while Dyad is running.
  const seen = new Set<string>();
  const segments: string[] = [];
  const currentSegments = currentPath
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const currentSegmentByKey = new Map<string, string>();
  for (const segment of currentSegments) {
    const key = normalizePathSegment(segment);
    if (!currentSegmentByKey.has(key)) {
      currentSegmentByKey.set(key, segment);
    }
  }
  const registryKeys = new Set(
    registryPath
      .split(";")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map(normalizePathSegment),
  );
  const currentOnlySegments = currentSegments.filter(
    (segment) => segment && !registryKeys.has(normalizePathSegment(segment)),
  );
  for (const segment of [...currentOnlySegments, ...registryPath.split(";")]) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }
    const key = normalizePathSegment(trimmed);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    segments.push(currentSegmentByKey.get(key) ?? trimmed);
  }
  return segments.join(";");
}

/**
 * Returns the current PATH merged with the machine + user PATH read from the
 * Windows registry, or null when the registry could not be read.
 *
 * A process only receives a copy of the environment at launch. When the user
 * installs Node.js while Dyad is running, the installer updates PATH in the
 * registry and broadcasts a settings change, but already-running processes
 * (and their children) keep the stale copy. Re-reading the registry is the
 * only way to pick up the new entries without restarting Dyad.
 */
export function readRefreshedWindowsPath(currentPath: string): string | null {
  const registryPath = readPathViaPowerShell() ?? readPathViaRegQuery();
  if (!registryPath) {
    logger.warn(
      "Could not read PATH from the Windows registry; keeping the current PATH.",
    );
    return null;
  }
  return mergeWindowsPathSegments(currentPath, registryPath);
}
