import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import log from "electron-log";
import { getUserDataPath } from "@/paths/paths";
import {
  spawnStreaming,
  type SpawnStreamingResult,
} from "@/ipc/utils/spawn_streaming";
import {
  runBufferedProcess,
  type BufferedProcessOptions,
  type BufferedProcessResult,
} from "@/ipc/utils/buffered_process";
import { forceRemoveContainer, runDockerCli } from "./docker_cli";
import { ensureRuntimeImage, type RuntimeImageKind } from "./runtime_image";
import { getAppNodeModulesVolumeName } from "./names";

export {
  getAppDevServerContainerName,
  getAppNodeModulesVolumeName,
  getLegacyAppPnpmStoreVolumeName,
} from "./names";

const logger = log.scope("docker_guest_command");

/**
 * Identifies this Dyad process. Guest job containers carry it so a later
 * process can remove jobs orphaned by a crash without touching jobs that
 * belong to a concurrently running Dyad.
 */
const DYAD_SESSION_ID = randomUUID();

export const PLAYWRIGHT_BROWSERS_VOLUME = "dyad-playwright-browsers";
export const GUEST_PLAYWRIGHT_BROWSERS_PATH = "/ms-playwright";
/** Where an in-tree (snapshot) install finds the app's shared pnpm store. */
const GUEST_APP_DEPS_MOUNT = "/dyad-app-deps";

/**
 * Maps a host path to where the guest sees it. POSIX paths are mounted at the
 * identical path, so compiler diagnostics, stack traces, and test reports the
 * guest writes need no translation. Windows drive paths cannot exist in a
 * Linux container and are mounted under `/host/<drive>/`.
 */
export function toGuestPath(
  hostPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") return path.posix.normalize(hostPath);
  const normalized = path.win32.resolve(hostPath);
  const match = normalized.match(/^([a-zA-Z]):\\?(.*)$/);
  if (!match) {
    throw new Error(`Cannot map ${hostPath} into the Docker runtime`);
  }
  const rest = match[2].split("\\").filter(Boolean).join("/");
  return `/host/${match[1].toLowerCase()}${rest ? `/${rest}` : ""}`;
}

/** Inverse of {@link toGuestPath} for paths found in guest output. */
export function fromGuestPath(
  guestPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") return guestPath;
  const match = guestPath.match(/^\/host\/([a-z])(?:\/(.*))?$/);
  if (!match) return guestPath;
  return `${match[1].toUpperCase()}:\\${(match[2] ?? "").split("/").join("\\")}`;
}

/** How the guest is kept from reading or writing a directory's `.git`. */
export type GitMask =
  | { kind: "none" }
  | { kind: "directory"; guestPath: string }
  | { kind: "file"; guestPath: string; emptyFileHostPath: string };

function getEmptyFileHostPath(): string {
  return path.join(getUserDataPath(), "docker-runtime", "empty-git-mask");
}

/**
 * Hides `<root>/.git` from the guest. Host Git reads repository-local config
 * and hooks from there, so a guest that could write it could make Dyad's next
 * `git status` run an arbitrary `core.fsmonitor` command on the host.
 */
export async function resolveGitMask(hostRoot: string): Promise<GitMask> {
  const gitPath = path.join(hostRoot, ".git");
  let stat: fsSync.Stats;
  try {
    stat = await fs.lstat(gitPath);
  } catch {
    return { kind: "none" };
  }
  const guestPath = toGuestPath(gitPath);
  if (stat.isDirectory()) return { kind: "directory", guestPath };
  const emptyFileHostPath = getEmptyFileHostPath();
  await fs.mkdir(path.dirname(emptyFileHostPath), { recursive: true });
  await fs.writeFile(emptyFileHostPath, "", { flag: "a" });
  return { kind: "file", guestPath, emptyFileHostPath };
}

/**
 * Values Dyad sets for every guest package-manager invocation. pnpm 11 reads
 * only `pnpm_config_*` for its own settings and ignores `npm_config_*`, so
 * pnpm settings are given in both spellings (npm still reads the latter).
 *
 * Deliberately no `CI`: with a lockfile present pnpm then defaults to
 * `--frozen-lockfile`, so a package.json edited ahead of its lockfile (routine
 * in a Dyad app) would fail every install. Commands that want CI behavior
 * (Playwright runs) pass it themselves, as the host does.
 */
export const GUEST_BASE_ENV: Readonly<Record<string, string>> = {
  COREPACK_ENABLE_PROJECT_SPEC: "0",
  COREPACK_ENABLE_STRICT: "0",
  npm_config_package_manager_strict: "false",
  pnpm_config_package_manager_strict: "false",
  npm_config_pm_on_fail: "ignore",
  pnpm_config_pm_on_fail: "ignore",
  PLAYWRIGHT_BROWSERS_PATH: GUEST_PLAYWRIGHT_BROWSERS_PATH,
};

function storeDirEnv(storeDir: string): Record<string, string> {
  return { npm_config_store_dir: storeDir, pnpm_config_store_dir: storeDir };
}

export interface GuestInvocationInput {
  appId: number;
  /**
   * Host directory mounted read-write into the guest: the app directory, or a
   * Dyad-owned snapshot worktree. Nothing outside it is visible to the guest.
   */
  hostRoot: string;
  /** Host path of the working directory; must be inside `hostRoot`. */
  cwd: string;
  command: string;
  args: string[];
  /**
   * Environment for the guest command. Only these keys enter the container —
   * the host environment (API keys, tokens, PATH) is never forwarded.
   */
  env?: Record<string, string | undefined>;
  /**
   * `app-volume`: `<hostRoot>/node_modules` is the app's persistent volume
   * (the app directory itself). `in-tree`: dependencies install inside the
   * mounted snapshot, sharing only the app's package store.
   */
  nodeModules: "app-volume" | "in-tree";
  image: RuntimeImageKind;
  gitMask: GitMask;
  /** Share the network namespace of a running container (the dev server). */
  joinNetworkOf?: string;
  /** Host ports published at the same port number (dev server only). */
  publishPorts?: number[];
  containerName?: string;
  role?: "job" | "app";
  /** Keep stdin attached (`docker run -i`) for commands that answer prompts. */
  interactive?: boolean;
}

export interface GuestInvocation {
  command: "docker";
  args: string[];
  /** Environment for the Docker CLI process (not the container). */
  clientEnv: NodeJS.ProcessEnv;
  containerName: string;
}

function assertInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${candidate} is outside the Docker runtime mount ${root}`);
  }
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Pure translation from a host command to its `docker run` invocation. */
export function buildGuestInvocation(
  input: GuestInvocationInput,
  imageTag: string,
  hostEnv: NodeJS.ProcessEnv = process.env,
): GuestInvocation {
  assertInside(input.hostRoot, input.cwd);
  const role = input.role ?? "job";
  const containerName =
    input.containerName ??
    `dyad-job-${input.appId}-${randomUUID().slice(0, 12)}`;
  const guestRoot = toGuestPath(input.hostRoot);
  const volume = getAppNodeModulesVolumeName(input.appId);

  const args = [
    "run",
    "--rm",
    "--init",
    ...(input.interactive ? ["-i"] : []),
    "--name",
    containerName,
    "--label",
    "dyad.managed=1",
    "--label",
    `dyad.role=${role}`,
    "--label",
    `dyad.app-id=${input.appId}`,
    "--label",
    `dyad.session=${DYAD_SESSION_ID}`,
    "--mount",
    `type=bind,source=${input.hostRoot},target=${guestRoot}`,
  ];

  const env: Record<string, string> = { ...GUEST_BASE_ENV };
  if (input.nodeModules === "app-volume") {
    args.push(
      "--mount",
      `type=volume,source=${volume},target=${guestRoot}/node_modules`,
    );
    // Same filesystem as node_modules, so pnpm hardlinks instead of copying.
    Object.assign(env, storeDirEnv(`${guestRoot}/node_modules/.pnpm-store`));
  } else {
    args.push(
      "--mount",
      `type=volume,source=${volume},target=${GUEST_APP_DEPS_MOUNT}`,
    );
    Object.assign(env, storeDirEnv(`${GUEST_APP_DEPS_MOUNT}/.pnpm-store`));
  }

  if (input.gitMask.kind === "directory") {
    args.push("--mount", `type=tmpfs,target=${input.gitMask.guestPath}`);
  } else if (input.gitMask.kind === "file") {
    args.push(
      "--mount",
      `type=bind,source=${input.gitMask.emptyFileHostPath},target=${input.gitMask.guestPath},readonly`,
    );
  }

  args.push(
    "--mount",
    `type=volume,source=${PLAYWRIGHT_BROWSERS_VOLUME},target=${GUEST_PLAYWRIGHT_BROWSERS_PATH}`,
  );

  if (input.joinNetworkOf) {
    args.push("--network", `container:${input.joinNetworkOf}`);
  } else {
    // Lets guest test fixtures reach Dyad's run-scoped lifecycle bridge.
    args.push("--add-host", "host.docker.internal:host-gateway");
  }
  for (const port of input.publishPorts ?? []) {
    args.push("-p", `${port}:${port}`);
  }

  const clientEnv: NodeJS.ProcessEnv = { ...hostEnv };
  for (const [key, value] of Object.entries(env)) {
    args.push("-e", `${key}=${value}`);
  }
  for (const [key, value] of Object.entries(input.env ?? {})) {
    if (value === undefined) continue;
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid environment variable name for guest: ${key}`);
    }
    // `-e KEY` without a value makes Docker read it from the client's
    // environment, so values (possibly secrets) never appear in argv.
    args.push("-e", key);
    clientEnv[key] = value;
  }

  args.push(
    "-w",
    toGuestPath(input.cwd),
    imageTag,
    input.command,
    ...input.args,
  );
  return { command: "docker", args, clientEnv, containerName };
}

let staleJobSweep: Promise<void> | undefined;

/**
 * Removes guest job containers left behind by a previous Dyad process (a crash
 * skips the per-job cleanup). Runs once per process.
 */
export function sweepStaleGuestJobs(): Promise<void> {
  staleJobSweep ??= (async () => {
    try {
      const result = await runDockerCli([
        // No -q: Docker ignores --format when -q is set, which would drop the
        // session label and sweep this process's own live jobs.
        "ps",
        "-a",
        "--filter",
        "label=dyad.managed=1",
        "--filter",
        "label=dyad.role=job",
        "--format",
        '{{.ID}} {{.Label "dyad.session"}}',
      ]);
      if (result.code !== 0) return;
      const stale = result.stdout
        .split("\n")
        .map((line) => line.trim().split(" "))
        .filter(([id, session]) => id && session !== DYAD_SESSION_ID)
        .map(([id]) => id);
      if (stale.length > 0) {
        logger.info(`Removing ${stale.length} stale Docker guest job(s)`);
        await runDockerCli(["rm", "-f", ...stale]);
      }
    } catch (error) {
      logger.warn("Failed to sweep stale Docker guest jobs:", error);
    }
  })();
  return staleJobSweep;
}

async function prepareGuestInvocation(
  input: GuestInvocationInput,
  onOutput?: (chunk: string) => void,
): Promise<GuestInvocation> {
  void sweepStaleGuestJobs();
  const imageTag = await ensureRuntimeImage(input.image, onOutput);
  return buildGuestInvocation(input, imageTag);
}

function needsForcedRemoval(result: {
  code: number | null;
  aborted: boolean;
  timedOut: boolean;
}) {
  return result.aborted || result.timedOut || result.code === null;
}

/**
 * Guest equivalent of {@link spawnStreaming}. Cancelling or timing out kills
 * the Docker client and then removes the container, which a killed client
 * would otherwise leave running.
 */
export async function runGuestStreaming(
  input: GuestInvocationInput,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    onOutput?: (chunk: string) => void;
    onProcess?: (child: ChildProcess) => void;
  } = {},
): Promise<SpawnStreamingResult> {
  if (options.signal?.aborted) {
    return {
      code: null,
      stdout: "",
      stderr: "",
      aborted: true,
      timedOut: false,
    };
  }
  const invocation = await prepareGuestInvocation(input, options.onOutput);
  let result: SpawnStreamingResult | undefined;
  try {
    result = await spawnStreaming({
      command: invocation.command,
      args: invocation.args,
      cwd: input.hostRoot,
      env: invocation.clientEnv,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      onOutput: options.onOutput,
      onProcess: options.onProcess,
    });
    return result;
  } finally {
    if (!result || needsForcedRemoval(result)) {
      await forceRemoveContainer(invocation.containerName);
    }
  }
}

/** Guest equivalent of {@link runBufferedProcess}. */
export async function runGuestBuffered(
  input: GuestInvocationInput,
  options: Omit<
    BufferedProcessOptions,
    "command" | "args" | "cwd" | "env" | "shell"
  > = {},
): Promise<BufferedProcessResult> {
  const invocation = await prepareGuestInvocation(input);
  let result: BufferedProcessResult | undefined;
  try {
    result = await runBufferedProcess({
      ...options,
      command: invocation.command,
      args: invocation.args,
      cwd: input.hostRoot,
      env: invocation.clientEnv,
      shell: false,
    });
    return result;
  } finally {
    if (!result || needsForcedRemoval(result)) {
      await forceRemoveContainer(invocation.containerName);
    }
  }
}

/** Convenience input for a command run in the live app directory. */
export async function appGuestInput({
  appId,
  appPath,
  cwd = appPath,
  command,
  args,
  env,
  image = "base",
  joinNetworkOf,
}: {
  appId: number;
  appPath: string;
  cwd?: string;
  command: string;
  args: string[];
  env?: Record<string, string | undefined>;
  image?: RuntimeImageKind;
  joinNetworkOf?: string;
}): Promise<GuestInvocationInput> {
  return {
    appId,
    hostRoot: appPath,
    cwd,
    command,
    args,
    env,
    nodeModules: "app-volume",
    image,
    gitMask: await resolveGitMask(appPath),
    joinNetworkOf,
  };
}

/** Convenience input for a command run inside a Dyad-owned snapshot. */
export async function snapshotGuestInput({
  appId,
  snapshotRoot,
  cwd,
  command,
  args,
  env,
  image = "base",
  joinNetworkOf,
}: {
  appId: number;
  snapshotRoot: string;
  cwd: string;
  command: string;
  args: string[];
  env?: Record<string, string | undefined>;
  image?: RuntimeImageKind;
  joinNetworkOf?: string;
}): Promise<GuestInvocationInput> {
  return {
    appId,
    hostRoot: snapshotRoot,
    cwd,
    command,
    args,
    env,
    nodeModules: "in-tree",
    image,
    gitMask: await resolveGitMask(snapshotRoot),
    joinNetworkOf,
  };
}
