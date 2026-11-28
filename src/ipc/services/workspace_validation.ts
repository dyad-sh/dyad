import { promises as fs } from "node:fs";
import path from "node:path";
import log from "electron-log";
import type { WorkspaceValidationCheck } from "@/db/schema";
import type { Problem } from "@/ipc/types";
import {
  getTypeCheckPreconditionKind,
  runTypeScriptCheck,
} from "@/ipc/processors/tsc";
import { spawnStreaming } from "@/ipc/utils/spawn_streaming";
import { getPackageManagerCommandEnv } from "@/ipc/utils/socket_firewall";
import { getUserDataPath } from "@/paths/paths";
import {
  BUILD_SNAPSHOT_PREFIX,
  BUILD_SNAPSHOT_ROOT_NAME,
  createGitOverlayWorkspace,
  removeGitOverlayWorkspace,
} from "./git_overlay_workspace";
import {
  type IsolatedPackageManager,
  resolvePackageManager,
  runCleanPackageInstall,
} from "./isolated_package_install";

const logger = log.scope("workspace_validation");

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const SCRIPT_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_TAIL_CHARS = 4_000;

/**
 * Validation of a workspace's combined result before integration.
 *
 * Checks run in a disposable checkout with its own dependency tree. Installs
 * and build scripts must not dirty the chat's checkout: integration can wait
 * for the original writer or merge a newer target and require a clean retry.
 * A missing check is reported as "missing" rather than silently passed.
 */
export interface ValidationRunInput {
  appPath: string;
  /** The target commit captured before merging it into the chat workspace. */
  baselineCommit?: string;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
}

/** How the snapshot installs: from its npm/pnpm workspace root, if any. */
interface SnapshotInstall {
  packageManager: IsolatedPackageManager;
  installPath: string;
}

export interface ValidationResult {
  checks: WorkspaceValidationCheck[];
  passed: boolean;
  /**
   * A check failed for a reason unrelated to the code (it timed out or its
   * tool could not run), so the same files may pass when checked again.
   */
  transientFailure?: boolean;
}

/** Failed checks whose failure says nothing about the code itself. */
const transientFailures = new WeakSet<WorkspaceValidationCheck>();

function transient(check: WorkspaceValidationCheck): WorkspaceValidationCheck {
  transientFailures.add(check);
  return check;
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

/**
 * Installs dependencies in the validation snapshot. Each snapshot starts
 * without node_modules, so this is always a clean install.
 */
async function installSnapshotDependencies(
  { appPath, signal, onOutput }: ValidationRunInput,
  { packageManager, installPath }: SnapshotInstall,
): Promise<WorkspaceValidationCheck> {
  if (!(await fileExists(path.join(appPath, "package.json")))) {
    return {
      name: "install",
      outcome: "missing",
      summary: "No package.json, so there are no dependencies to install.",
    };
  }
  const result = await runCleanPackageInstall({
    cwd: installPath,
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
  return {
    name: "install",
    outcome: "passed",
    summary: `Installed dependencies with ${packageManager}.`,
  };
}

function diagnosticKey(problem: Problem, appPath: string): string {
  // The checker reports an absolute path for files in sibling packages.
  // Both checkouts need to identify the same file by the same path.
  const file = path.isAbsolute(problem.file)
    ? path.relative(appPath, problem.file)
    : problem.file;
  return `${file.replaceAll("\\", "/")}\u0000${problem.code}\u0000${problem.message}`;
}

function failedTypeCheck(
  summary: string,
  problems: Problem[],
): WorkspaceValidationCheck {
  return {
    name: "type-check",
    outcome: "failed",
    summary,
    output: tail(
      problems
        .slice(0, 30)
        .map(
          (problem) =>
            `${problem.file}:${problem.line}:${problem.column} TS${problem.code}: ${problem.message}`,
        )
        .join("\n"),
    ),
  };
}

async function checkBaseline(
  input: ValidationRunInput,
  install: SnapshotInstall,
): Promise<Map<string, number> | null> {
  const check = await installSnapshotDependencies(input, install);
  if (check.outcome === "failed" || check.outcome === "skipped") {
    throw new Error(check.summary);
  }
  const report = await runTypeScriptCheck({ appPath: input.appPath });
  if (report.outcome === "incomplete") return null;
  // A second copy of a diagnostic the target already has once is still new.
  const existing = new Map<string, number>();
  for (const problem of report.problems) {
    const key = diagnosticKey(problem, input.appPath);
    existing.set(key, (existing.get(key) ?? 0) + 1);
  }
  return existing;
}

async function runTypeCheck(
  { appPath }: ValidationRunInput,
  readBaseline?: () => ReturnType<typeof checkBaseline>,
): Promise<WorkspaceValidationCheck> {
  if (
    !(await fileExists(path.join(appPath, "tsconfig.app.json"))) &&
    !(await fileExists(path.join(appPath, "tsconfig.json")))
  ) {
    return {
      name: "type-check",
      outcome: "missing",
      summary:
        "No tsconfig.app.json or tsconfig.json, so there is no type-check to run.",
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
    if (readBaseline && report.outcome !== "incomplete") {
      try {
        const existing = await readBaseline();
        if (!existing) {
          return failedTypeCheck(
            "TypeScript could not check the target configuration.",
            report.problems,
          );
        }
        const introduced = report.problems.filter((problem) => {
          const key = diagnosticKey(problem, appPath);
          const remaining = existing.get(key) ?? 0;
          if (remaining === 0) return true;
          existing.set(key, remaining - 1);
          return false;
        });
        if (introduced.length === 0) {
          return {
            name: "type-check",
            outcome: "passed",
            summary: `No new TypeScript errors (${report.problems.length} already existed on the target branch).`,
          };
        }
        return failedTypeCheck(
          `${introduced.length} new TypeScript error${introduced.length === 1 ? "" : "s"}.`,
          introduced,
        );
      } catch (error) {
        logger.warn("Type-check baseline failed; reporting strictly", error);
        // A target without TypeScript or a config has no comparable diagnostics.
        // A failed checkout or dependency install can succeed on the next attempt.
        if (!getTypeCheckPreconditionKind(error)) {
          const message =
            error instanceof Error ? error.message : String(error);
          return transient(
            failedTypeCheck(
              `Could not compare TypeScript errors with the target branch. ${message}`,
              report.problems,
            ),
          );
        }
      }
    }
    return failedTypeCheck(
      report.outcome === "incomplete"
        ? "TypeScript could not check the project because of a configuration error."
        : `${report.problems.length} TypeScript error${report.problems.length === 1 ? "" : "s"}.`,
      report.problems,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The snapshot's install already succeeded, so a missing TypeScript
    // package or config will still be missing next time: report the check
    // as missing (which does not block) rather than as a transient failure.
    switch (getTypeCheckPreconditionKind(error)) {
      case "typescript-not-found":
        return {
          name: "type-check",
          outcome: "missing",
          // Also covers an installed package whose metadata is unreadable
          // or that declares no `tsc` CLI.
          summary:
            "No usable TypeScript CLI was found, so there is no type-check to run.",
          output: tail(message),
        };
      case "tsconfig-not-found":
        return {
          name: "type-check",
          outcome: "missing",
          summary:
            "TypeScript found no tsconfig, so there is no type-check to run.",
          output: tail(message),
        };
      default:
        return transient({
          name: "type-check",
          outcome: "failed",
          summary: "TypeScript could not run.",
          output: tail(message),
        });
    }
  }
}

const BROWSER_TEST_PATTERN = /\b(playwright|cypress|webdriver|puppeteer)\b/i;
// `--watch`, Jest's `--watchAll` / `--watch-all`, but not an explicit
// `=false` (Create React App's `test --watchAll=false` runs once).
const WATCH_FLAG_PATTERN = /--watch(?:All|-all)?(?![\w-])(?!=(?:false|0)\b)/;

async function runScript(
  name: "build" | "test",
  input: ValidationRunInput,
  scripts: Record<string, string> | null,
  { packageManager }: SnapshotInstall,
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
    const check: WorkspaceValidationCheck = {
      name,
      outcome: "failed",
      summary: result.timedOut
        ? `${packageManager} run ${name} timed out.`
        : `${packageManager} run ${name} failed.`,
      output: tail(`${result.stdout}\n${result.stderr}`),
    };
    return result.timedOut ? transient(check) : check;
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
export function validateWorkspace(
  input: ValidationRunInput,
): Promise<ValidationResult> {
  const { baselineCommit } = input;
  const readBaseline = baselineCommit
    ? () => withValidationSnapshot(input, baselineCommit, checkBaseline)
    : undefined;
  return withValidationSnapshot(input, undefined, (snapshot, install) =>
    runWorkspaceChecks(snapshot, install, readBaseline),
  );
}

async function withValidationSnapshot<T>(
  input: ValidationRunInput,
  commit: string | undefined,
  run: (snapshot: ValidationRunInput, install: SnapshotInstall) => Promise<T>,
): Promise<T> {
  const snapshot = await createGitOverlayWorkspace({
    sourceTargetPath: input.appPath,
    commit,
    scratchRoot: path.join(getUserDataPath(), BUILD_SNAPSHOT_ROOT_NAME),
    directoryPrefix: BUILD_SNAPSHOT_PREFIX,
    purpose: "build",
    excludedTargetRootNames: new Set([
      ".output",
      ".next",
      ".nuxt",
      ".vite",
      ".svelte-kit",
      "dist",
      "build",
      "out",
      "coverage",
    ]),
    signal: input.signal,
  });
  try {
    // An app that is a member of an npm/pnpm workspace installs from the
    // workspace root (root dependencies, workspace links), as its own
    // installs do; scripts still run in the app's folder.
    const repoPath = commit ? snapshot.worktreePath : snapshot.sourceRepoPath;
    const { packageManager, sourceInstallPath } = await resolvePackageManager(
      commit ? snapshot.targetPath : snapshot.sourceTargetPath,
      repoPath,
    );
    return await run(
      { ...input, appPath: snapshot.targetPath },
      {
        packageManager,
        installPath: path.join(
          snapshot.worktreePath,
          path.relative(repoPath, sourceInstallPath),
        ),
      },
    );
  } finally {
    await removeGitOverlayWorkspace(
      snapshot.worktreePath,
      snapshot.sourceRepoPath,
    );
  }
}

async function runWorkspaceChecks(
  input: ValidationRunInput,
  install: SnapshotInstall,
  readBaseline?: () => ReturnType<typeof checkBaseline>,
): Promise<ValidationResult> {
  const checks: WorkspaceValidationCheck[] = [];
  const installCheck = await installSnapshotDependencies(input, install);
  checks.push(installCheck);
  if (installCheck.outcome === "failed" || installCheck.outcome === "skipped") {
    return { checks, passed: false };
  }
  const scripts = await readPackageScripts(input.appPath);
  checks.push(await runTypeCheck(input, readBaseline));
  if (input.signal?.aborted) return { checks, passed: false };
  checks.push(await runScript("build", input, scripts, install));
  if (input.signal?.aborted) return { checks, passed: false };
  checks.push(await runScript("test", input, scripts, install));
  // Missing and skipped checks are reported, never counted as passes, but
  // they do not block: an app without a test script can still integrate.
  return {
    checks,
    passed:
      !input.signal?.aborted &&
      checks.every((check) => check.outcome !== "failed"),
    transientFailure: checks.some((check) => transientFailures.has(check)),
  };
}

export function describeValidationFailure(
  checks: readonly WorkspaceValidationCheck[],
): string {
  const failed = checks.filter((check) => check.outcome === "failed");
  if (failed.length === 0) return "Validation was cancelled.";
  return failed.map((check) => `${check.name}: ${check.summary}`).join(" ");
}
