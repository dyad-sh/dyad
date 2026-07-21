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
import { typescriptUtilityProcessScheduler } from "./typescript_utility_process_scheduler";

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
  includeAgentInstructions,
}: {
  kind: TypeCheckPreconditionKind;
  appPath: string;
  includeAgentInstructions?: boolean;
}): Promise<string> {
  if (kind === "tsconfig-not-found") {
    return "Type checking could not run: TypeScript is installed but no tsconfig was found (expected `tsconfig.app.json` or `tsconfig.json`). You can create a suitable tsconfig for this project and retry.";
  }

  const declaresTypeScript = await packageJsonDeclaresTypeScript(appPath);

  if (declaresTypeScript) {
    if (!includeAgentInstructions) {
      return "Type checking could not run: TypeScript is listed in package.json but is not installed (node_modules is missing or incomplete). Install dependencies, then retry.";
    }

    return 'Type checking could not run: TypeScript is listed in package.json but is not installed (node_modules is missing or incomplete). Tell the user to use Rebuild to reinstall dependencies, include `<dyad-command type="rebuild"></dyad-command>` so they can accept with one click, then retry `run_type_checks`.';
  }

  return includeAgentInstructions
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
  // Walk the same ancestor node_modules locations Node would search, but do
  // not use require.resolve here. Node caches successful resolutions for the
  // life of the Electron main process, so a Rebuild that replaces a pnpm
  // symlink can otherwise keep returning the deleted package's real path.
  let currentPath = path.resolve(appPath);
  let packageJsonPath: string | undefined;
  while (true) {
    const candidate = path.join(
      currentPath,
      "node_modules",
      "typescript",
      "package.json",
    );
    try {
      await fs.access(candidate);
      packageJsonPath = candidate;
      break;
    } catch {
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        break;
      }
      currentPath = parentPath;
    }
  }

  if (!packageJsonPath) {
    throw new TypeCheckPreconditionError(
      "typescript-not-found",
      `Failed to load TypeScript from ${appPath}: package is not installed`,
    );
  }

  const entryPath = path.join(path.dirname(packageJsonPath), "lib", "tsc.js");
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

function getBuildInfoPath({
  appPath,
  configPath,
  version,
}: {
  appPath: string;
  configPath: string;
  version: string;
}): string {
  const key = createHash("sha256")
    .update(`${appPath}\0${configPath}\0${version}`)
    .digest("hex");
  return path.join(getTypeScriptCachePath(), `${key}.tsbuildinfo`);
}

export async function runTypeScriptCheck({
  appPath,
}: {
  appPath: string;
}): Promise<ProblemReport> {
  return typescriptUtilityProcessScheduler.runExclusive("tsc", async () => {
    try {
      const cli = await resolveTypeScriptCli(appPath);
      const configPath = await findTypeScriptConfig(appPath);
      const version = await getTypeScriptVersion(cli, appPath);
      const buildInfoPath = getBuildInfoPath({
        appPath,
        configPath,
        version,
      });
      await fs.mkdir(path.dirname(buildInfoPath), { recursive: true });

      logger.info(`Starting TypeScript ${version} CLI check for ${appPath}`);
      const result = await runCli(cli, appPath, [
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
        "--explainFiles",
        "false",
        "--traceResolution",
        "false",
        "--noEmit",
        "--incremental",
        "--tsBuildInfoFile",
        buildInfoPath,
        "--project",
        configPath,
      ]);

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
      const parsed = parseTypeScriptDiagnosticsDetailed(
        output,
        appPath,
        configPath,
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
        isTypeScriptConfigDiagnostic(problem, configPath),
      )
        ? "incomplete"
        : "errors";

      return {
        ...(await addSnippets(parsed.problems, appPath)),
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
