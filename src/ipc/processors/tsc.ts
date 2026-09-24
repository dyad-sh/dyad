import { createHash } from "node:crypto";
import * as path from "node:path";
import * as fs from "node:fs/promises";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { Problem, ProblemReport } from "@/ipc/types";
import log from "electron-log";
import { getTypeScriptCachePath } from "@/paths/paths";
import { getPackageManagerCommandEnv } from "@/ipc/utils/socket_firewall";
import { prependPathSegment } from "@/ipc/utils/managed_tools";
import {
  runBufferedProcess,
  type BufferedProcessResult,
} from "@/ipc/utils/buffered_process";
import { isVersionAtLeast } from "@/shared/version_utils";
import { isDockerRuntimeActive } from "@/ipc/services/docker_runtime/runtime_mode";
import {
  appGuestInput,
  fromGuestPath,
  runGuestBuffered,
  toGuestPath,
} from "@/ipc/services/docker_runtime/guest_command";
import {
  isMissingPathError,
  resolveTypeScriptPackageJsonPath,
} from "../../../shared/node_module_resolution";
import { typescriptUtilityProcessScheduler } from "./typescript_utility_process_scheduler";

export { isMissingPathError } from "../../../shared/node_module_resolution";

const logger = log.scope("tsc");

export type TypeCheckPreconditionKind =
  | "typescript-not-found"
  | "tsconfig-not-found";

export class TypeCheckPreconditionError extends DyadError {
  readonly typeCheckKind: TypeCheckPreconditionKind;

  constructor(
    typeCheckKind: TypeCheckPreconditionKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, DyadErrorKind.Precondition, options);
    this.name = "TypeCheckPreconditionError";
    this.typeCheckKind = typeCheckKind;
  }
}

function getStringMatchedTypeCheckPreconditionKind(
  message: string,
): TypeCheckPreconditionKind | undefined {
  if (
    message.startsWith("Failed to load TypeScript from") ||
    message.includes("Cannot find module 'typescript'") ||
    message.startsWith("No local TypeScript CLI found")
  ) {
    return "typescript-not-found";
  }

  if (message.startsWith("No TypeScript configuration file found")) {
    return "tsconfig-not-found";
  }

  return undefined;
}

export function getTypeCheckPreconditionKind(
  error: unknown,
): TypeCheckPreconditionKind | undefined {
  if (error instanceof TypeCheckPreconditionError) {
    return error.typeCheckKind;
  }

  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  return getStringMatchedTypeCheckPreconditionKind(message);
}

async function packageJsonDeclaresTypeScript(
  appPath: string,
): Promise<boolean> {
  try {
    const raw = await fs.readFile(path.join(appPath, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };

    return (
      parsed.dependencies?.typescript !== undefined ||
      parsed.devDependencies?.typescript !== undefined
    );
  } catch {
    return false;
  }
}

export async function getTypeCheckPreconditionGuidance({
  kind,
  appPath,
  agentInstructionMode,
}: {
  kind: TypeCheckPreconditionKind;
  appPath: string;
  agentInstructionMode?: "dyad-command" | "local-agent-tool";
}): Promise<string> {
  if (kind === "tsconfig-not-found") {
    return "Type checking could not run: TypeScript is installed but no tsconfig was found (expected `tsconfig.app.json` or `tsconfig.json`). You can create a suitable tsconfig for this project and retry.";
  }

  const declaresTypeScript = await packageJsonDeclaresTypeScript(appPath);

  if (declaresTypeScript) {
    if (!agentInstructionMode) {
      return "Type checking could not run: TypeScript is listed in package.json but is not installed (node_modules is missing or incomplete). Install dependencies, then retry.";
    }

    if (agentInstructionMode === "local-agent-tool") {
      return "Type checking could not run: TypeScript is listed in package.json but is not installed (node_modules is missing or incomplete). Call `reinstall_and_restart_app` to reinstall dependencies, then retry `run_type_checks`.";
    }

    return 'Type checking could not run: TypeScript is listed in package.json but is not installed (node_modules is missing or incomplete). Tell the user to use Rebuild to reinstall dependencies, include `<dyad-command type="rebuild"></dyad-command>` so they can accept with one click, then retry `run_type_checks`.';
  }

  return agentInstructionMode
    ? 'Type checking is unavailable: this project does not use TypeScript (no `typescript` entry in package.json). Do not call `run_type_checks` again in this conversation. Verify your changes by reading the files instead. At the end of your reply, recommend that the user add TypeScript to the project so you can automatically catch and fix type errors, and include `<dyad-command type="add-typescript"></dyad-command>` so they can accept with one click.'
    : "Type checking is unavailable: this project does not use TypeScript (no `typescript` entry in package.json). Add TypeScript to enable type checking.";
}

export function toProblemReportError(
  error: unknown,
  errorKind?: TypeCheckPreconditionKind,
): Error {
  if (error instanceof DyadError) {
    return error;
  }

  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  const typeCheckKind =
    errorKind ?? getStringMatchedTypeCheckPreconditionKind(message);

  if (typeCheckKind) {
    return new TypeCheckPreconditionError(typeCheckKind, message, {
      cause: error,
    });
  }

  return error instanceof Error ? error : new Error(message);
}

const TSC_TIMEOUT_MS = 5 * 60 * 1000;
const TSC_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const GUEST_PROBE_TIMEOUT_MS = 60 * 1000;
const GUEST_PROBE_MAX_OUTPUT_BYTES = 64 * 1024;
const CONFIG_NAMES = ["tsconfig.app.json", "tsconfig.json"] as const;
const versionCache = new Map<string, string>();

interface ParsedDiagnostic extends Problem {
  absoluteFilePath: string;
}

interface ParsedDiagnostics {
  problems: ParsedDiagnostic[];
  skippedLines: string[];
}

interface TypeScriptCli {
  entryPath: string;
}

interface TypeScriptPackageJson {
  bin?: Record<string, unknown>;
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function isWindowsPath(filePath: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\)/.test(filePath);
}

function getPathApi(filePath: string): typeof path.posix | typeof path.win32 {
  return isWindowsPath(filePath) ? path.win32 : path.posix;
}

function isTypeScriptConfigDiagnostic(
  problem: ParsedDiagnostic,
  configPath: string,
): boolean {
  const pathApi = getPathApi(problem.absoluteFilePath);
  const normalizedProblemPath = pathApi.normalize(problem.absoluteFilePath);
  const normalizedConfigPath = pathApi.normalize(configPath);

  if (
    isWindowsPath(normalizedProblemPath) &&
    normalizedProblemPath.toLowerCase() === normalizedConfigPath.toLowerCase()
  ) {
    return true;
  }

  if (normalizedProblemPath === normalizedConfigPath) {
    return true;
  }

  return /^tsconfig(?:\..+)?\.json$/i.test(
    pathApi.basename(normalizedProblemPath),
  );
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const pathApi = getPathApi(rootPath);
  const relative = pathApi.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith(`..${pathApi.sep}`) &&
      relative !== ".." &&
      !pathApi.isAbsolute(relative))
  );
}

function parseTypeScriptDiagnosticsDetailed(
  output: string,
  appPath: string,
  configPath?: string,
): ParsedDiagnostics {
  const problems: ParsedDiagnostic[] = [];
  const skippedLines: string[] = [];
  let current: ParsedDiagnostic | undefined;

  for (const rawLine of output.replaceAll("\r\n", "\n").split("\n")) {
    if (!rawLine.trim()) {
      continue;
    }

    const match = rawLine.match(/^(.*)\((\d+),(\d+)\): error TS(\d+):\s*(.*)$/);
    if (match) {
      const reportedPath = match[1];
      const pathApi = getPathApi(
        isWindowsPath(reportedPath) ? reportedPath : appPath,
      );
      const absoluteFilePath = pathApi.isAbsolute(reportedPath)
        ? pathApi.normalize(reportedPath)
        : pathApi.resolve(appPath, reportedPath);
      const relativePath = isPathInside(appPath, absoluteFilePath)
        ? pathApi.relative(appPath, absoluteFilePath)
        : absoluteFilePath;
      current = {
        file: normalizePath(relativePath),
        line: Number(match[2]),
        column: Number(match[3]),
        code: Number(match[4]),
        message: match[5],
        snippet: "",
        absoluteFilePath,
      };
      problems.push(current);
      continue;
    }

    const globalMatch = rawLine.match(/^error TS(\d+):\s*(.*)$/);
    if (globalMatch) {
      const diagnosticPath = configPath ?? path.join(appPath, "tsconfig.json");
      const pathApi = getPathApi(diagnosticPath);
      current = {
        file: normalizePath(pathApi.relative(appPath, diagnosticPath)),
        line: 1,
        column: 1,
        code: Number(globalMatch[1]),
        message: globalMatch[2],
        snippet: "",
        absoluteFilePath: diagnosticPath,
      };
      problems.push(current);
      continue;
    }

    if (/^\s+/.test(rawLine) && current) {
      current.message += `\n${rawLine.trimEnd()}`;
      continue;
    }

    if (/^(?:Found \d+ errors?|Errors\s+Files\s*$)/.test(rawLine)) {
      current = undefined;
      continue;
    }

    current = undefined;
    skippedLines.push(rawLine);
  }

  if (problems.length === 0) {
    if (skippedLines.length > 0) {
      throw new Error(
        `Unrecognized TypeScript diagnostic output: ${skippedLines[0]}`,
      );
    }
    throw new Error("TypeScript exited with no parseable file diagnostics");
  }

  return { problems, skippedLines };
}

export function parseTypeScriptDiagnostics(
  output: string,
  appPath: string,
  configPath?: string,
): ParsedDiagnostic[] {
  return parseTypeScriptDiagnosticsDetailed(output, appPath, configPath)
    .problems;
}

async function addSnippets(
  problems: ParsedDiagnostic[],
  appPath: string,
): Promise<ProblemReport> {
  const withSnippets = await Promise.all(
    problems.map(async ({ absoluteFilePath, ...problem }) => {
      if (!isPathInside(appPath, absoluteFilePath)) {
        return problem;
      }

      try {
        const lines = (await fs.readFile(absoluteFilePath, "utf8")).split(
          /\r?\n/,
        );
        const lineIndex = problem.line - 1;
        if (lineIndex < 0 || lineIndex >= lines.length) {
          return problem;
        }
        const snippetLines = [];
        if (lineIndex > 0) {
          snippetLines.push(lines[lineIndex - 1]);
        }
        snippetLines.push(
          `${lines[lineIndex]} // <-- TypeScript compiler error here`,
        );
        if (lineIndex + 1 < lines.length) {
          snippetLines.push(lines[lineIndex + 1]);
        }
        return { ...problem, snippet: snippetLines.join("\n").trim() };
      } catch {
        return problem;
      }
    }),
  );

  return { problems: withSnippets };
}

async function findTypeScriptConfig(appPath: string): Promise<string> {
  for (const configName of CONFIG_NAMES) {
    const configPath = path.join(appPath, configName);
    try {
      await fs.access(configPath);
      return configPath;
    } catch {
      // Try the next supported config name.
    }
  }

  throw new TypeCheckPreconditionError(
    "tsconfig-not-found",
    `No TypeScript configuration file found in ${appPath}. Expected one of: ${CONFIG_NAMES.join(", ")}`,
  );
}

async function resolveTypeScriptCli(appPath: string): Promise<TypeScriptCli> {
  let packageJsonPath: string;
  try {
    packageJsonPath = await resolveTypeScriptPackageJsonPath(appPath);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    throw new TypeCheckPreconditionError(
      "typescript-not-found",
      `Failed to load TypeScript from ${appPath}: package is not installed`,
      { cause: error },
    );
  }

  const packagePath = path.dirname(packageJsonPath);
  let binPath: unknown;
  try {
    const packageJson = JSON.parse(
      await fs.readFile(packageJsonPath, "utf8"),
    ) as TypeScriptPackageJson;
    binPath = packageJson.bin?.tsc;
  } catch (error) {
    throw new TypeCheckPreconditionError(
      "typescript-not-found",
      `Failed to read TypeScript package metadata at ${packageJsonPath}`,
      { cause: error },
    );
  }

  if (typeof binPath !== "string") {
    throw new TypeCheckPreconditionError(
      "typescript-not-found",
      `No local TypeScript CLI declared in ${packageJsonPath}`,
    );
  }

  const entryPath = path.resolve(packagePath, binPath);
  try {
    await fs.access(entryPath);
  } catch (error) {
    throw new TypeCheckPreconditionError(
      "typescript-not-found",
      `No local TypeScript CLI found at ${entryPath}`,
      { cause: error },
    );
  }

  return { entryPath };
}

function getTypeScriptCommandEnv(appPath: string): NodeJS.ProcessEnv {
  return prependPathSegment(
    getPackageManagerCommandEnv(),
    path.join(appPath, "node_modules", ".bin"),
  );
}

async function runCli(
  cli: TypeScriptCli,
  appPath: string,
  args: string[],
): Promise<BufferedProcessResult> {
  // Run the TypeScript JS entry point with the user's selected Node runtime,
  // resolved from PATH like every other app child process (reloadNodePath
  // keeps the custom/managed/system choice at its front). Not our own binary:
  // packaged builds disable the RunAsNode fuse. Not the node_modules/.bin
  // shim either: it needs cmd.exe on Windows, whose argument quoting breaks
  // for paths containing spaces.
  return runBufferedProcess({
    command: "node",
    args: [cli.entryPath, ...args],
    cwd: appPath,
    env: getTypeScriptCommandEnv(appPath),
    shell: false,
    timeoutMs: TSC_TIMEOUT_MS,
    maxOutputBytes: TSC_MAX_OUTPUT_BYTES,
    // The scheduler must not release its memory-heavy-work slot until the
    // process and its stdio have actually closed.
    waitForCloseAfterForceKill: true,
  });
}

async function getTypeScriptVersion(
  cli: TypeScriptCli,
  appPath: string,
): Promise<string> {
  const realEntryPath = await fs.realpath(cli.entryPath);
  const stats = await fs.stat(realEntryPath);
  const cacheKey = `${realEntryPath}:${stats.mtimeMs}`;
  const cached = versionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await runCli(cli, appPath, ["--version"]);
  if (
    result.code !== 0 ||
    result.signal ||
    result.timedOut ||
    result.stdoutTruncated ||
    result.stderrTruncated
  ) {
    throw new Error(
      `Failed to determine local TypeScript version: ${result.stderr || result.stdout || `exit code ${result.code}`}`,
    );
  }
  const match = result.stdout.trim().match(/^Version\s+(.+)$/);
  if (!match) {
    throw new Error(
      `Unexpected output from local TypeScript --version: ${result.stdout.trim()}`,
    );
  }
  versionCache.set(cacheKey, match[1]);
  return match[1];
}

function getBuildInfoKey({
  appPath,
  configPath,
  version,
}: {
  appPath: string;
  configPath: string;
  version: string;
}): string {
  return createHash("sha256")
    .update(`${appPath}\0${configPath}\0${version}`)
    .digest("hex");
}

/** A resolved TypeScript CLI plus where and how it runs. */
interface TypeScriptCheckRunner {
  version: string;
  /** App directory as the CLI sees it; its diagnostics are relative to it. */
  cliAppPath: string;
  /** tsconfig path as the CLI sees it. */
  cliConfigPath: string;
  buildInfoPath: string;
  run(args: string[]): Promise<BufferedProcessResult>;
  toHostPath(cliPath: string): string;
}

async function createHostRunner(
  appPath: string,
  configPath: () => Promise<string>,
): Promise<TypeScriptCheckRunner> {
  const cli = await resolveTypeScriptCli(appPath);
  const resolvedConfigPath = await configPath();
  const version = await getTypeScriptVersion(cli, appPath);
  const buildInfoPath = path.join(
    getTypeScriptCachePath(),
    `${getBuildInfoKey({ appPath, configPath: resolvedConfigPath, version })}.tsbuildinfo`,
  );
  await fs.mkdir(path.dirname(buildInfoPath), { recursive: true });
  return {
    version,
    cliAppPath: appPath,
    cliConfigPath: resolvedConfigPath,
    buildInfoPath,
    run: (args) => runCli(cli, appPath, args),
    toHostPath: (cliPath) => cliPath,
  };
}

/**
 * Resolves the app's TypeScript CLI inside the Docker runtime. Dyad authors
 * this script; it only reads `typescript/package.json` as data (it never loads
 * the package) and walks ancestor `node_modules` like
 * {@link resolveTypeScriptPackageJsonPath} does on the host. `argv[1]` is the
 * buildinfo directory to create, which lives in the app's node_modules volume
 * because Dyad's host cache is not mounted into the guest.
 */
const GUEST_TYPESCRIPT_PROBE = `
const fs = require("fs");
const path = require("path");
function findPackageJson(dir) {
  for (;;) {
    const candidate = path.join(dir, "node_modules", "typescript", "package.json");
    try {
      fs.accessSync(candidate);
      return candidate;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function probe() {
  const packageJsonPath = findPackageJson(process.cwd());
  if (!packageJsonPath) return { status: "not-installed" };
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (error) {
    return { status: "unreadable", packageJsonPath, error: String(error) };
  }
  const bin = meta && meta.bin && meta.bin.tsc;
  if (typeof bin !== "string") return { status: "no-cli", packageJsonPath };
  const entryPath = path.resolve(path.dirname(packageJsonPath), bin);
  try {
    fs.accessSync(entryPath);
  } catch (error) {
    return { status: "missing-cli", entryPath, error: String(error) };
  }
  fs.mkdirSync(process.argv[1], { recursive: true });
  return { status: "ok", entryPath, version: meta.version };
}
process.stdout.write(JSON.stringify(probe()));
`;

type GuestProbeResult =
  | { status: "not-installed" }
  | { status: "unreadable"; packageJsonPath: string; error: string }
  | { status: "no-cli"; packageJsonPath: string }
  | { status: "missing-cli"; entryPath: string; error: string }
  | { status: "ok"; entryPath: string; version: string };

function parseGuestProbeResult(stdout: string): GuestProbeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(
      `Unexpected output while resolving TypeScript in the Docker runtime: ${stdout.slice(0, 300)}`,
    );
  }
  const result = parsed as Record<string, unknown> | null;
  const isString = (key: string) => typeof result?.[key] === "string";
  switch (result?.status) {
    case "not-installed":
      return { status: "not-installed" };
    case "unreadable":
      if (isString("packageJsonPath")) {
        return result as GuestProbeResult;
      }
      break;
    case "no-cli":
      if (isString("packageJsonPath")) {
        return result as GuestProbeResult;
      }
      break;
    case "missing-cli":
      if (isString("entryPath")) {
        return result as GuestProbeResult;
      }
      break;
    case "ok":
      if (
        isString("entryPath") &&
        isString("version") &&
        /^\d+\.\d+\.\d+/.test(result.version as string)
      ) {
        return result as GuestProbeResult;
      }
      break;
  }
  throw new Error(
    `Unexpected result while resolving TypeScript in the Docker runtime: ${stdout.slice(0, 300)}`,
  );
}

function describeGuestResultFailure(result: BufferedProcessResult): string {
  if (result.timedOut) return "timed out";
  if (result.aborted || result.signal) {
    return `terminated${result.signal ? ` with ${result.signal}` : ""}`;
  }
  return (
    result.stderr.trim() ||
    result.stdout.trim() ||
    `exit code ${result.code}`
  ).slice(0, 1000);
}

/**
 * Docker mode: the app's TypeScript package is app-controlled code and its
 * live `node_modules` exists only in the container volume, so both resolution
 * and the check itself run in the guest. Only the host-side precondition
 * classification below treats a guest answer as "not installed"; Docker and
 * spawn failures surface as ordinary errors.
 */
async function createGuestRunner(
  appId: number,
  appPath: string,
  configPath: () => Promise<string>,
): Promise<TypeScriptCheckRunner> {
  const guestAppPath = toGuestPath(appPath);
  const guestBuildInfoDir = path.posix.join(
    guestAppPath,
    "node_modules",
    ".cache",
    "dyad-tsc",
  );
  const runGuest = async (
    command: string,
    args: string[],
    limits: { timeoutMs: number; maxOutputBytes: number },
  ) =>
    runGuestBuffered(await appGuestInput({ appId, appPath, command, args }), {
      ...limits,
      // The scheduler must not release its memory-heavy-work slot until the
      // container's client process and its stdio have actually closed.
      waitForCloseAfterForceKill: true,
    });

  const probeResult = await runGuest(
    "node",
    ["-e", GUEST_TYPESCRIPT_PROBE, guestBuildInfoDir],
    {
      timeoutMs: GUEST_PROBE_TIMEOUT_MS,
      maxOutputBytes: GUEST_PROBE_MAX_OUTPUT_BYTES,
    },
  );
  if (
    probeResult.code !== 0 ||
    probeResult.signal ||
    probeResult.timedOut ||
    probeResult.aborted ||
    probeResult.stdoutTruncated ||
    probeResult.stderrTruncated
  ) {
    throw new Error(
      `Failed to resolve TypeScript in the Docker runtime: ${describeGuestResultFailure(probeResult)}`,
    );
  }

  const probe = parseGuestProbeResult(probeResult.stdout.trim());
  switch (probe.status) {
    case "not-installed":
      throw new TypeCheckPreconditionError(
        "typescript-not-found",
        `Failed to load TypeScript from ${appPath}: package is not installed`,
      );
    case "unreadable":
      throw new TypeCheckPreconditionError(
        "typescript-not-found",
        `Failed to read TypeScript package metadata at ${fromGuestPath(probe.packageJsonPath)}`,
        { cause: new Error(probe.error) },
      );
    case "no-cli":
      throw new TypeCheckPreconditionError(
        "typescript-not-found",
        `No local TypeScript CLI declared in ${fromGuestPath(probe.packageJsonPath)}`,
      );
    case "missing-cli":
      throw new TypeCheckPreconditionError(
        "typescript-not-found",
        `No local TypeScript CLI found at ${fromGuestPath(probe.entryPath)}`,
        { cause: new Error(probe.error) },
      );
  }

  const resolvedConfigPath = await configPath();
  const { entryPath, version } = probe;
  const buildInfoPath = path.posix.join(
    guestBuildInfoDir,
    `${getBuildInfoKey({ appPath, configPath: resolvedConfigPath, version })}.tsbuildinfo`,
  );
  return {
    version,
    cliAppPath: guestAppPath,
    cliConfigPath: toGuestPath(resolvedConfigPath),
    buildInfoPath,
    run: (args) =>
      runGuest("node", [entryPath, ...args], {
        timeoutMs: TSC_TIMEOUT_MS,
        maxOutputBytes: TSC_MAX_OUTPUT_BYTES,
      }),
    toHostPath: (cliPath) => fromGuestPath(cliPath),
  };
}

export async function runTypeScriptCheck({
  appId,
  appPath,
}: {
  appId: number;
  appPath: string;
}): Promise<ProblemReport> {
  return typescriptUtilityProcessScheduler.runExclusive("tsc", async () => {
    try {
      const findConfig = () => findTypeScriptConfig(appPath);
      const runner = isDockerRuntimeActive()
        ? await createGuestRunner(appId, appPath, findConfig)
        : await createHostRunner(appPath, findConfig);
      const { version, cliAppPath, cliConfigPath } = runner;

      logger.info(`Starting TypeScript ${version} CLI check for ${appPath}`);
      // Defensive "off" toggles: keep the bounded diagnostics parser from being
      // corrupted by user-configured output flags. Two of them are version-gated.
      // --explainFiles: added in TypeScript 4.2; earlier tsc rejects it with
      //   error TS5023 and aborts before reporting any diagnostics.
      const args = [
        "--pretty",
        "false",
        "--diagnostics",
        "false",
        "--extendedDiagnostics",
        "false",
        "--listFiles",
        "false",
        "--listEmittedFiles",
        "false",
      ];
      if (isVersionAtLeast(version, "4.2.0")) {
        args.push("--explainFiles", "false");
      }
      args.push("--traceResolution", "false", "--noEmit");
      // --incremental + --noEmit: TypeScript 4.0 lifted the restriction that
      // --incremental required emit. On 3.9, --incremental + --noEmit errors
      // with TS5053, and --tsBuildInfoFile alone errors with TS5069 (it
      // requires --incremental or --composite), so skip both on < 4.0 and run
      // a full, non-incremental check. Incremental caching is a perf
      // optimization, not a correctness need.
      if (isVersionAtLeast(version, "4.0.0")) {
        args.push("--incremental", "--tsBuildInfoFile", runner.buildInfoPath);
      }
      args.push("--project", cliConfigPath);
      const result = await runner.run(args);

      if (result.timedOut) {
        throw new Error(`Type check timed out after ${TSC_TIMEOUT_MS / 1000}s`);
      }
      if (result.aborted || result.signal) {
        throw new Error(
          `Type check process terminated${result.signal ? ` with ${result.signal}` : ""}`,
        );
      }
      if (result.stdoutTruncated || result.stderrTruncated) {
        throw new Error(
          `TypeScript diagnostic output exceeded ${TSC_MAX_OUTPUT_BYTES} bytes`,
        );
      }
      if (result.code === 0) {
        return { problems: [], outcome: "passed" };
      }
      if (result.code === null) {
        throw new Error("TypeScript process exited without a status code");
      }

      const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
      // Parse in the CLI's own path space; the Docker guest may see the app
      // at a different path than the host (Windows).
      const parsed = parseTypeScriptDiagnosticsDetailed(
        output,
        cliAppPath,
        cliConfigPath,
      );
      if (parsed.skippedLines.length > 0) {
        const preview = parsed.skippedLines
          .slice(0, 3)
          .map((line) => line.slice(0, 300));
        logger.warn(
          `Ignored ${parsed.skippedLines.length} unrecognized line(s) after parsing TypeScript diagnostics:`,
          preview,
        );
      }
      const outcome = parsed.problems.some((problem) =>
        isTypeScriptConfigDiagnostic(problem, cliConfigPath),
      )
        ? "incomplete"
        : "errors";
      const hostProblems = parsed.problems.map((problem) => ({
        ...problem,
        absoluteFilePath: runner.toHostPath(problem.absoluteFilePath),
      }));

      return {
        ...(await addSnippets(hostProblems, appPath)),
        outcome,
      };
    } catch (error) {
      throw toProblemReportError(error);
    }
  });
}

export function clearTypeScriptVersionCacheForTests(): void {
  versionCache.clear();
}
