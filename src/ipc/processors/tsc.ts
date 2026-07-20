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
  BufferedProcessSpawnError,
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

interface TypeScriptCli {
  command: string;
  argsPrefix: string[];
  shimPath: string;
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function getPathApi(filePath: string): typeof path.posix | typeof path.win32 {
  return /^[A-Za-z]:[\\/]/.test(filePath) ? path.win32 : path.posix;
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

export function parseTypeScriptDiagnostics(
  output: string,
  appPath: string,
): ParsedDiagnostic[] {
  const problems: ParsedDiagnostic[] = [];
  let current: ParsedDiagnostic | undefined;

  for (const rawLine of output.replaceAll("\r\n", "\n").split("\n")) {
    if (!rawLine.trim()) {
      continue;
    }

    const match = rawLine.match(/^(.*)\((\d+),(\d+)\): error TS(\d+):\s*(.*)$/);
    if (match) {
      const reportedPath = match[1];
      const pathApi = getPathApi(
        /^[A-Za-z]:[\\/]/.test(reportedPath) ? reportedPath : appPath,
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

    if (/^\s+/.test(rawLine) && current) {
      current.message += `\n${rawLine.trimEnd()}`;
      continue;
    }

    throw new Error(`Unrecognized TypeScript diagnostic output: ${rawLine}`);
  }

  if (problems.length === 0) {
    throw new Error("TypeScript exited with no parseable file diagnostics");
  }

  return problems;
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
  const packageJsonPath = path.join(
    appPath,
    "node_modules",
    "typescript",
    "package.json",
  );
  try {
    await fs.realpath(packageJsonPath);
  } catch (error) {
    throw new TypeCheckPreconditionError(
      "typescript-not-found",
      `Failed to load TypeScript from ${appPath}: package is not installed`,
      { cause: error },
    );
  }

  const shimPath = path.join(
    appPath,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsc.cmd" : "tsc",
  );
  try {
    await fs.access(shimPath);
  } catch (error) {
    throw new TypeCheckPreconditionError(
      "typescript-not-found",
      `No local TypeScript CLI found at ${shimPath}`,
      { cause: error },
    );
  }

  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      argsPrefix: ["/d", "/s", "/c", shimPath],
      shimPath,
    };
  }

  return { command: shimPath, argsPrefix: [], shimPath };
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
  return runBufferedProcess({
    command: cli.command,
    args: [...cli.argsPrefix, ...args],
    cwd: appPath,
    env: getTypeScriptCommandEnv(appPath),
    shell: false,
    timeoutMs: TSC_TIMEOUT_MS,
    maxOutputBytes: TSC_MAX_OUTPUT_BYTES,
  });
}

async function getTypeScriptVersion(
  cli: TypeScriptCli,
  appPath: string,
): Promise<string> {
  const realShimPath = await fs.realpath(cli.shimPath);
  const stats = await fs.stat(realShimPath);
  const cacheKey = `${realShimPath}:${stats.mtimeMs}`;
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
        return { problems: [] };
      }
      if (result.code === null) {
        throw new Error("TypeScript process exited without a status code");
      }

      const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
      return await addSnippets(
        parseTypeScriptDiagnostics(output, appPath),
        appPath,
      );
    } catch (error) {
      if (error instanceof BufferedProcessSpawnError) {
        throw new Error(
          `Failed to start local TypeScript CLI: ${error.message}`,
        );
      }
      throw toProblemReportError(error);
    }
  });
}

export function clearTypeScriptVersionCacheForTests(): void {
  versionCache.clear();
}
