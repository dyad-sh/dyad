/**
 * Locates the official Claude Code CLI on this machine and reports its
 * version and authentication state.
 *
 * Dyad never bundles, patches, or authenticates the CLI: users install it and
 * sign in with Anthropic's own flow (`claude` then `/login`). Dyad only needs
 * to know whether a supported, signed-in CLI exists.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fixPath from "fix-path";
import log from "electron-log";
import { buildWindowsCommandInvocation } from "@/ipc/utils/windows_command";
import { readSettings } from "@/main/settings";

const logger = log.scope("claude_code_cli_locator");

/** Oldest CLI release Dyad drives: it needs the stream-json control protocol. */
export const MIN_SUPPORTED_CLAUDE_CODE_VERSION = "2.0.0";
/** Release the integration was validated against. */
export const TESTED_CLAUDE_CODE_VERSION = "2.1.260";

const CACHE_TTL_MS = 60_000;
const COMMAND_TIMEOUT_MS = 20_000;

export interface ClaudeCodeCliLocation {
  executablePath: string;
  version: string | null;
  versionSupported: boolean;
  source: "env" | "settings" | "path" | "known-location";
}

export interface ClaudeCodeAuthStatus {
  state: "authenticated" | "unauthenticated" | "unknown";
  method: string | null;
  subscriptionType: string | null;
  email: string | null;
  detail: string | null;
}

export interface ClaudeCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

let pathFixed = false;
function ensureShellPath(): void {
  if (pathFixed) return;
  pathFixed = true;
  try {
    // GUI-launched Electron apps on macOS do not inherit the user's shell
    // PATH, where `claude` normally lives.
    fixPath();
  } catch (error) {
    logger.warn("fix-path failed", error);
  }
}

export function parseCliVersion(output: string): string | null {
  const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function isSupportedClaudeCodeVersion(version: string | null): boolean {
  if (!version) return false;
  return compareVersions(version, MIN_SUPPORTED_CLAUDE_CODE_VERSION) >= 0;
}

/**
 * Environment for child `claude` processes. Strips every credential or
 * provider override that would make the CLI bill an API key or a cloud
 * provider instead of the user's subscription; Dyad must never silently fall
 * back to API billing.
 */
export function buildClaudeCliEnvironment(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of Object.keys(env)) {
    if (
      key === "ANTHROPIC_API_KEY" ||
      key === "ANTHROPIC_AUTH_TOKEN" ||
      key === "ANTHROPIC_BASE_URL" ||
      key === "ANTHROPIC_PROFILE" ||
      key === "CLAUDE_CODE_USE_BEDROCK" ||
      key === "CLAUDE_CODE_USE_VERTEX" ||
      key === "CLAUDE_CODE_USE_FOUNDRY" ||
      key === "CLAUDE_CODE_SIMPLE" ||
      key === "CLAUDE_CODE_SAFE_MODE" ||
      key.startsWith("ANTHROPIC_FEDERATION_") ||
      key.startsWith("ANTHROPIC_IDENTITY_") ||
      key === "ANTHROPIC_ORGANIZATION_ID" ||
      key === "ANTHROPIC_SERVICE_ACCOUNT_ID" ||
      key === "ANTHROPIC_WORKSPACE_ID"
    ) {
      delete env[key];
    }
  }
  env.DISABLE_AUTOUPDATER = "1";
  env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE = "1";
  return env;
}

export function runClaudeCommand(
  executablePath: string,
  args: string[],
  {
    cwd = os.homedir(),
    timeoutMs = COMMAND_TIMEOUT_MS,
  }: { cwd?: string; timeoutMs?: number } = {},
): Promise<ClaudeCommandResult> {
  ensureShellPath();
  const invocation = buildWindowsCommandInvocation(executablePath, args);
  return new Promise((resolve, reject) => {
    execFile(
      invocation.command,
      invocation.args,
      {
        cwd,
        env: buildClaudeCliEnvironment(),
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error && !("code" in error && typeof error.code === "number")) {
          // Spawn failure (ENOENT, EACCES, timeout) rather than a non-zero exit.
          const nodeError = error as NodeJS.ErrnoException & {
            killed?: boolean;
          };
          if (nodeError.killed) {
            resolve({ code: null, stdout: String(stdout), stderr: "timeout" });
            return;
          }
          reject(error);
          return;
        }
        resolve({
          code: error ? ((error as { code?: number }).code ?? 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

function candidateExecutableNames(): string[] {
  return process.platform === "win32"
    ? ["claude.exe", "claude.cmd", "claude"]
    : ["claude"];
}

function knownInstallLocations(): string[] {
  const home = os.homedir();
  const locations = [
    path.join(home, ".local", "bin"),
    path.join(home, ".claude", "local"),
    path.join(home, ".claude", "local", "node_modules", ".bin"),
  ];
  if (process.platform === "win32") {
    if (process.env.APPDATA) {
      locations.push(path.join(process.env.APPDATA, "npm"));
    }
    if (process.env.LOCALAPPDATA) {
      locations.push(path.join(process.env.LOCALAPPDATA, "Programs", "claude"));
    }
  } else {
    locations.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin");
    locations.push(path.join(home, ".npm-global", "bin"));
    locations.push(path.join(home, ".volta", "bin"));
  }
  return locations;
}

function isExecutableFile(candidate: string): boolean {
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) return false;
    if (process.platform !== "win32") {
      fs.accessSync(candidate, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function findInDirectories(directories: string[]): string | null {
  for (const directory of directories) {
    if (!directory) continue;
    for (const name of candidateExecutableNames()) {
      const candidate = path.join(directory, name);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

interface LocationCandidate {
  executablePath: string;
  source: ClaudeCodeCliLocation["source"];
}

function resolveCandidate(): LocationCandidate | null {
  ensureShellPath();
  const envOverride = process.env.DYAD_CLAUDE_CODE_EXECUTABLE?.trim();
  if (envOverride) {
    return { executablePath: envOverride, source: "env" };
  }
  const settingsOverride = readSettings().claudeCodeExecutablePath?.trim();
  if (settingsOverride) {
    return { executablePath: settingsOverride, source: "settings" };
  }
  const pathDirectories = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  const fromPath = findInDirectories(pathDirectories);
  if (fromPath) {
    return { executablePath: fromPath, source: "path" };
  }
  const fromKnown = findInDirectories(knownInstallLocations());
  if (fromKnown) {
    return { executablePath: fromKnown, source: "known-location" };
  }
  return null;
}

let locationCache: { value: ClaudeCodeCliLocation | null; at: number } | null =
  null;
let authCache: {
  executablePath: string;
  value: ClaudeCodeAuthStatus;
  at: number;
} | null = null;

export function invalidateClaudeCodeCliCache(): void {
  locationCache = null;
  authCache = null;
}

export async function locateClaudeCodeCli({
  refresh = false,
}: { refresh?: boolean } = {}): Promise<ClaudeCodeCliLocation | null> {
  if (
    !refresh &&
    locationCache &&
    Date.now() - locationCache.at < CACHE_TTL_MS
  ) {
    return locationCache.value;
  }
  const candidate = resolveCandidate();
  let value: ClaudeCodeCliLocation | null = null;
  if (candidate) {
    let version: string | null = null;
    try {
      const result = await runClaudeCommand(candidate.executablePath, [
        "--version",
      ]);
      version =
        parseCliVersion(result.stdout) ?? parseCliVersion(result.stderr);
      if (result.code !== 0 && !version) {
        logger.warn(
          `claude --version exited with ${result.code}: ${result.stderr.trim()}`,
        );
      }
    } catch (error) {
      logger.warn(`Unable to run ${candidate.executablePath} --version`, error);
      // An override that cannot execute is reported as not installed.
      value = null;
      locationCache = { value, at: Date.now() };
      return value;
    }
    value = {
      executablePath: candidate.executablePath,
      version,
      versionSupported: isSupportedClaudeCodeVersion(version),
      source: candidate.source,
    };
  }
  locationCache = { value, at: Date.now() };
  return value;
}

export function parseAuthStatusOutput(stdout: string): ClaudeCodeAuthStatus {
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) {
    return {
      state: "unknown",
      method: null,
      subscriptionType: null,
      email: null,
      detail: "Could not read the CLI sign-in state.",
    };
  }
  try {
    const parsed = JSON.parse(stdout.slice(jsonStart)) as {
      loggedIn?: boolean;
      authMethod?: string;
      subscriptionType?: string;
      email?: string;
    };
    if (parsed.loggedIn === true) {
      return {
        state: "authenticated",
        method: parsed.authMethod ?? null,
        subscriptionType: parsed.subscriptionType ?? null,
        email: parsed.email ?? null,
        detail: null,
      };
    }
    if (parsed.loggedIn === false) {
      return {
        state: "unauthenticated",
        method: null,
        subscriptionType: null,
        email: null,
        detail: "Not signed in. Run `claude` in a terminal and use /login.",
      };
    }
  } catch {
    // fall through
  }
  return {
    state: "unknown",
    method: null,
    subscriptionType: null,
    email: null,
    detail: "Could not read the CLI sign-in state.",
  };
}

export async function getClaudeCodeAuthStatus(
  executablePath: string,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<ClaudeCodeAuthStatus> {
  if (
    !refresh &&
    authCache &&
    authCache.executablePath === executablePath &&
    Date.now() - authCache.at < CACHE_TTL_MS
  ) {
    return authCache.value;
  }
  let value: ClaudeCodeAuthStatus;
  try {
    const result = await runClaudeCommand(executablePath, ["auth", "status"]);
    value = parseAuthStatusOutput(result.stdout);
    if (value.state === "unknown" && result.stderr.trim()) {
      value = { ...value, detail: result.stderr.trim().slice(0, 300) };
    }
  } catch (error) {
    logger.warn("claude auth status failed", error);
    value = {
      state: "unknown",
      method: null,
      subscriptionType: null,
      email: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  authCache = { executablePath, value, at: Date.now() };
  return value;
}
