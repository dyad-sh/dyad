import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import log from "electron-log";
import type { WorkspaceValidationCheck } from "@/db/schema";
import { runTypeScriptCheck } from "@/ipc/processors/tsc";
import { spawnStreaming } from "@/ipc/utils/spawn_streaming";
import { getPackageManagerCommandEnv } from "@/ipc/utils/socket_firewall";
import {
  resolvePackageManager,
  runCleanPackageInstall,
} from "./isolated_package_install";

const logger = log.scope("workspace_validation");

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const SCRIPT_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_TAIL_CHARS = 4_000;
const INSTALL_MARKER = ".dyad-workspace-install";

/**
 * Validation of a workspace's combined result before integration.
 *
 * Checks run against the workspace's own dependency tree, installed into the
 * worktree, so a preview or install in the app's original directory is never
 * reused or disturbed. A missing check is reported as "missing" rather than
 * silently counted as a pass.
 */
export interface ValidationRunInput {
  appPath: string;
  /** The app's original directory, used only for a type-check baseline. */
  baselineAppPath?: string;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
}

export interface ValidationResult {
  checks: WorkspaceValidationCheck[];
  passed: boolean;
}

function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > OUTPUT_TAIL_CHARS
    ? `…${trimmed.slice(-OUTPUT_TAIL_CHARS)}`
    : trimmed;
}

async function readPackageScripts(
  appPath: string,
): Promise<Record<string, string> | null> {
  try {
    const manifest = JSON.parse(
      await fs.readFile(path.join(appPath, "package.json"), "utf8"),
    ) as { scripts?: Record<string, unknown> };
    const scripts: Record<string, string> = {};
    for (const [name, value] of Object.entries(manifest.scripts ?? {})) {
      if (typeof value === "string") scripts[name] = value;
    }
    return scripts;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs
    .stat(filePath)
    .then(() => true)
    .catch(() => false);
}

async function dependencyFingerprint(appPath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for (const name of [
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ]) {
    try {
      hash.update(name);
      hash.update(await fs.readFile(path.join(appPath, name)));
    } catch {
      hash.update("<missing>");
    }
  }
  return hash.digest("hex");
}

/**
 * Installs the workspace's dependencies when its manifest or lockfile changed
 * since the last install (or nothing is installed yet).
 */
export async function ensureWorkspaceDependencies({
  appPath,
  signal,
  onOutput,
}: ValidationRunInput): Promise<WorkspaceValidationCheck> {
  if (!(await fileExists(path.join(appPath, "package.json")))) {
    return {
      name: "install",
      outcome: "missing",
      summary: "No package.json, so there are no dependencies to install.",
    };
  }
  const fingerprint = await dependencyFingerprint(appPath);
  const markerPath = path.join(appPath, "node_modules", INSTALL_MARKER);
  const installed = await fs.readFile(markerPath, "utf8").catch(() => null);
  if (installed === fingerprint) {
    return {
      name: "install",
      outcome: "passed",
      summary: "Dependencies are already installed in this workspace.",
    };
  }
  const { packageManager } = await resolvePackageManager(appPath);
  const result = await runCleanPackageInstall({
    cwd: appPath,
    packageManager,
    signal,
    timeoutMs: INSTALL_TIMEOUT_MS,
    onOutput,
  });
  if (result.aborted) {
    return {
      name: "install",
      outcome: "skipped",
      summary: "Dependency install was cancelled.",
    };
  }
  if (result.code !== 0) {
    return {
      name: "install",
      outcome: "failed",
      summary: result.timedOut
        ? `${packageManager} install timed out.`
        : `${packageManager} install failed.`,
      output: tail(`${result.stdout}\n${result.stderr}`),
    };
  }
  await fs.mkdir(path.dirname(markerPath), { recursive: true });
  await fs.writeFile(markerPath, fingerprint, "utf8");
  return {
    name: "install",
    outcome: "passed",
    summary: `Installed dependencies with ${packageManager}.`,
  };
}

function diagnosticKey(problem: {
  file: string;
  code: number;
  message: string;
}): string {
  return `${problem.file.replaceAll("\\", "/")}\u0000${problem.code}\u0000${problem.message}`;
}

async function runTypeCheck({
  appPath,
  baselineAppPath,
}: ValidationRunInput): Promise<WorkspaceValidationCheck> {
  if (!(await fileExists(path.join(appPath, "tsconfig.json")))) {
    return {
      name: "type-check",
      outcome: "missing",
      summary: "No tsconfig.json, so there is no type-check to run.",
    };
  }
  try {
    const report = await runTypeScriptCheck({ appPath });
    if (report.problems.length === 0 && report.outcome !== "incomplete") {
      return {
        name: "type-check",
        outcome: "passed",
        summary: "TypeScript reported no errors.",
      };
    }
    // Errors the target branch already had are not caused by combining this
    // chat's work; only newly introduced diagnostics block integration.
    if (baselineAppPath && report.outcome !== "incomplete") {
      try {
        const baseline = await runTypeScriptCheck({
          appPath: baselineAppPath,
        });
        const existing = new Set(baseline.problems.map(diagnosticKey));
        const introduced = report.problems.filter(
          (problem) => !existing.has(diagnosticKey(problem)),
        );
        if (introduced.length === 0) {
          return {
            name: "type-check",
            outcome: "passed",
            summary: `No new TypeScript errors (${report.problems.length} already existed on the target branch).`,
          };
        }
        return {
          name: "type-check",
          outcome: "failed",
          summary: `${introduced.length} new TypeScript error${introduced.length === 1 ? "" : "s"}.`,
          output: tail(
            introduced
              .slice(0, 30)
              .map(
                (problem) =>
                  `${problem.file}:${problem.line}:${problem.column} TS${problem.code}: ${problem.message}`,
              )
              .join("\n"),
          ),
        };
      } catch (error) {
        logger.warn("Type-check baseline failed; reporting strictly", error);
      }
    }
    return {
      name: "type-check",
      outcome: "failed",
      summary:
        report.outcome === "incomplete"
          ? "TypeScript could not check the project because of a configuration error."
          : `${report.problems.length} TypeScript error${report.problems.length === 1 ? "" : "s"}.`,
      output: tail(
        report.problems
          .slice(0, 30)
          .map(
            (problem) =>
              `${problem.file}:${problem.line}:${problem.column} TS${problem.code}: ${problem.message}`,
          )
          .join("\n"),
      ),
    };
  } catch (error) {
    return {
      name: "type-check",
      outcome: "failed",
      summary: "TypeScript could not run.",
      output: tail(error instanceof Error ? error.message : String(error)),
    };
  }
}

const BROWSER_TEST_PATTERN = /\b(playwright|cypress|webdriver|puppeteer)\b/i;
const WATCH_FLAG_PATTERN = /--watch\b/;

async function runScript(
  name: "build" | "test",
  input: ValidationRunInput,
  scripts: Record<string, string> | null,
): Promise<WorkspaceValidationCheck> {
  const script = scripts?.[name];
  if (!script) {
    return {
      name,
      outcome: "missing",
      summary: `package.json has no "${name}" script.`,
    };
  }
  if (name === "test" && BROWSER_TEST_PATTERN.test(script)) {
    return {
      name,
      outcome: "skipped",
      summary:
        "The test script runs browser tests, which need a running preview; run them from the Tests panel.",
    };
  }
  if (WATCH_FLAG_PATTERN.test(script)) {
    return {
      name,
      outcome: "skipped",
      summary: `The "${name}" script runs in watch mode and would never finish.`,
    };
  }
  const { packageManager } = await resolvePackageManager(input.appPath);
  const result = await spawnStreaming({
    command: packageManager,
    args: ["run", name],
    cwd: input.appPath,
    env: { ...getPackageManagerCommandEnv(), CI: "true" },
    signal: input.signal,
    timeoutMs: SCRIPT_TIMEOUT_MS,
    onOutput: input.onOutput,
  });
  if (result.aborted) {
    return {
      name,
      outcome: "skipped",
      summary: `The ${name} was cancelled.`,
    };
  }
  if (result.code !== 0) {
    return {
      name,
      outcome: "failed",
      summary: result.timedOut
        ? `${packageManager} run ${name} timed out.`
        : `${packageManager} run ${name} failed.`,
      output: tail(`${result.stdout}\n${result.stderr}`),
    };
  }
  return {
    name,
    outcome: "passed",
    summary: `${packageManager} run ${name} succeeded.`,
  };
}

/**
 * Installs dependencies, then runs the type-check, build, and unit tests
 * against the combined workspace. Stops after a failed install because every
 * later check would fail for the same reason.
 */
export async function validateWorkspace(
  input: ValidationRunInput,
): Promise<ValidationResult> {
  const checks: WorkspaceValidationCheck[] = [];
  const install = await ensureWorkspaceDependencies(input);
  checks.push(install);
  if (install.outcome === "failed" || install.outcome === "skipped") {
    return { checks, passed: false };
  }
  const scripts = await readPackageScripts(input.appPath);
  checks.push(await runTypeCheck(input));
  if (input.signal?.aborted) return { checks, passed: false };
  checks.push(await runScript("build", input, scripts));
  if (input.signal?.aborted) return { checks, passed: false };
  checks.push(await runScript("test", input, scripts));
  // Missing and skipped checks are reported, never counted as passes, but
  // they do not block: an app without a test script can still integrate.
  return {
    checks,
    passed:
      !input.signal?.aborted &&
      checks.every((check) => check.outcome !== "failed"),
  };
}

export function describeValidationFailure(
  checks: readonly WorkspaceValidationCheck[],
): string {
  const failed = checks.filter((check) => check.outcome === "failed");
  if (failed.length === 0) return "Validation was cancelled.";
  return failed.map((check) => `${check.name}: ${check.summary}`).join(" ");
}
