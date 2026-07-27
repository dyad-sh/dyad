import { z } from "zod";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { getAgentGitStatus } from "@/ipc/utils/git_utils";
import { getPathEnvKey } from "@/ipc/utils/path_env";
import {
  PtyCommandExecutionError,
  runPtyCommand,
} from "@/ipc/utils/pty_command_runner";
import { buildWindowsCommandInvocation } from "@/ipc/utils/windows_command";
import {
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
  ToolDefinition,
} from "./types";

const MAX_COMMAND_CHARS = 20_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const CONSENT_PREVIEW_CHARS = 500;
const MAX_FILE_FINGERPRINT_BYTES = 128 * 1024;
const MAX_SNAPSHOT_FINGERPRINT_BYTES = 8 * 1024 * 1024;

const mutationByInvocation = new WeakMap<AgentContext, boolean>();

const bashSchema = z.object({
  command: z
    .string()
    .min(1)
    .max(MAX_COMMAND_CHARS)
    .describe("Shell command to run from the current app root"),
});

export function buildShellInvocation(
  command: string,
  platform: NodeJS.Platform = process.platform,
  shell = process.env.SHELL ?? "/bin/sh",
  comSpec = process.env.ComSpec ?? "cmd.exe",
): { command: string; args: string[] } {
  if (platform === "win32") {
    return buildWindowsCommandInvocation(
      comSpec,
      ["/d", "/s", "/c", command],
      platform,
      comSpec,
    );
  }
  return buildWindowsCommandInvocation(shell, ["-lc", command], platform);
}

const SAFE_ENV_KEYS = [
  "CI",
  "COLORTERM",
  "FORCE_COLOR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NO_COLOR",
  "TERM",
] as const;

export function buildSanitizedShellEnv(
  tempPath: string,
  source: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const pathKey = getPathEnvKey(source);
  if (source[pathKey]) env[pathKey] = source[pathKey];
  for (const key of SAFE_ENV_KEYS) {
    if (source[key]) env[key] = source[key];
  }
  if (platform === "win32") {
    for (const key of ["ComSpec", "PATHEXT", "SystemRoot", "windir"] as const) {
      if (source[key]) env[key] = source[key];
    }
    env.USERPROFILE = tempPath;
  } else {
    env.HOME = tempPath;
  }
  env.TEMP = tempPath;
  env.TMP = tempPath;
  env.TMPDIR = tempPath;
  return env;
}

async function prepareShellExecution(command: string): Promise<{
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
}> {
  const invocation = buildShellInvocation(command);
  const tempPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-bash-"));
  return {
    ...invocation,
    env: buildSanitizedShellEnv(tempPath),
    cleanup: () => fs.rm(tempPath, { recursive: true, force: true }),
  };
}

type AgentGitStatus = Awaited<ReturnType<typeof getAgentGitStatus>>;

interface WorkspaceStatusSnapshot {
  status: AgentGitStatus;
  fingerprints: Record<string, string>;
}

async function fingerprintWorkspacePath(
  appPath: string,
  relativePath: string,
  maxContentBytes: number,
  signal?: AbortSignal,
): Promise<{ fingerprint: string; bytesRead: number }> {
  const resolvedAppPath = path.resolve(appPath);
  const resolvedPath = path.resolve(resolvedAppPath, relativePath);
  const relativeToApp = path.relative(resolvedAppPath, resolvedPath);
  if (
    relativeToApp === ".." ||
    relativeToApp.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToApp)
  ) {
    return { fingerprint: "outside-app", bytesRead: 0 };
  }

  try {
    signal?.throwIfAborted();
    const stat = await fs.lstat(resolvedPath);
    if (stat.isSymbolicLink()) {
      return {
        fingerprint: `symlink:${await fs.readlink(resolvedPath)}`,
        bytesRead: 0,
      };
    }
    if (!stat.isFile()) {
      return {
        fingerprint: `other:${stat.mode}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`,
        bytesRead: 0,
      };
    }

    const sampleBytes = Math.min(maxContentBytes, MAX_FILE_FINGERPRINT_BYTES);
    const metadata = `${stat.mode}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    if (sampleBytes === 0) {
      return { fingerprint: `file:${metadata}:metadata-only`, bytesRead: 0 };
    }
    const handle = await fs.open(resolvedPath, "r");
    try {
      const hash = createHash("sha256");
      let bytesRead = 0;
      const readSample = async (length: number, position: number) => {
        if (length === 0) return;
        signal?.throwIfAborted();
        const buffer = Buffer.allocUnsafe(length);
        const result = await handle.read(buffer, 0, length, position);
        signal?.throwIfAborted();
        hash.update(buffer.subarray(0, result.bytesRead));
        bytesRead += result.bytesRead;
      };

      if (stat.size <= sampleBytes) {
        await readSample(stat.size, 0);
      } else {
        const firstBytes = Math.ceil(sampleBytes / 2);
        const lastBytes = sampleBytes - firstBytes;
        await readSample(firstBytes, 0);
        await readSample(lastBytes, stat.size - lastBytes);
      }
      return {
        fingerprint: `file:${metadata}:${hash.digest("hex")}`,
        bytesRead,
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "unknown";
    return { fingerprint: `error:${code}`, bytesRead: 0 };
  }
}

async function captureWorkspaceStatus(
  appPath: string,
  signal?: AbortSignal,
): Promise<WorkspaceStatusSnapshot> {
  const status = await getAgentGitStatus({ path: appPath, signal });
  const paths = [
    ...new Set([
      ...status.conflicted,
      ...status.staged,
      ...status.unstaged,
      ...status.untracked,
    ]),
  ].sort();
  const fingerprints: Record<string, string> = {};
  let remainingContentBytes = MAX_SNAPSHOT_FINGERPRINT_BYTES;
  for (const relativePath of paths) {
    signal?.throwIfAborted();
    const result = await fingerprintWorkspacePath(
      appPath,
      relativePath,
      remainingContentBytes,
      signal,
    );
    fingerprints[relativePath] = result.fingerprint;
    remainingContentBytes -= result.bytesRead;
  }
  return { status, fingerprints };
}

function workspaceStatusChanged(
  before: WorkspaceStatusSnapshot,
  after: WorkspaceStatusSnapshot | null,
): boolean {
  if (after === null || before.status.truncated || after.status.truncated) {
    return true;
  }
  return JSON.stringify(before) !== JSON.stringify(after);
}

function commandPreview(command: string): string {
  return command.length <= CONSENT_PREVIEW_CHARS
    ? command
    : `${command.slice(0, CONSENT_PREVIEW_CHARS)}...`;
}

export const bashTool: ToolDefinition<z.infer<typeof bashSchema>> = {
  name: "bash",
  description:
    "Run a user-approved shell command with host user permissions from the current app root. Use focused, non-interactive commands and avoid starting long-lived development servers.",
  inputSchema: bashSchema,
  defaultConsent: "ask",
  modifiesState: true,

  getConsentPreview: (args) => args.command,
  shouldTrackMutation: (_args, _result, ctx) =>
    mutationByInvocation.get(ctx) ?? false,

  buildXml: (args, isComplete) => {
    if (isComplete || !args.command) return undefined;
    return `<dyad-status title="${escapeXmlAttr(`Running: ${commandPreview(args.command)}`)}"></dyad-status>`;
  },

  execute: async (args, ctx: AgentContext) => {
    mutationByInvocation.set(ctx, false);
    const beforeStatus = await captureWorkspaceStatus(
      ctx.appPath,
      ctx.abortSignal,
    );
    const execution = await prepareShellExecution(args.command);
    let commandSucceeded = false;
    ctx.onXmlStream(
      `<dyad-status title="${escapeXmlAttr(`Running: ${commandPreview(args.command)}`)}"></dyad-status>`,
    );

    try {
      const result = await runPtyCommand(execution.command, execution.args, {
        cwd: ctx.appPath,
        displayCommand: args.command,
        env: execution.env,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        signal: ctx.abortSignal,
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
      commandSucceeded = true;
      const output = result.output || "Command completed with no output.";
      ctx.onXmlComplete(
        `<dyad-output type="shell" message="Shell command completed">\n${escapeXmlContent(output)}\n</dyad-output>`,
      );
      return output;
    } catch (error) {
      if (isDyadError(error)) throw error;
      if (error instanceof PtyCommandExecutionError) {
        const details = [error.message, error.output]
          .filter(Boolean)
          .join("\n\n");
        throw new DyadError(details, DyadErrorKind.External);
      }
      throw error;
    } finally {
      const afterStatus = await captureWorkspaceStatus(ctx.appPath).catch(
        () => null,
      );
      const didMutate = workspaceStatusChanged(beforeStatus, afterStatus);
      mutationByInvocation.set(ctx, didMutate);
      if (!commandSucceeded && didMutate) {
        ctx.mutationCount = (ctx.mutationCount ?? 0) + 1;
        ctx.workspaceMutated = true;
      }
      await execution.cleanup();
    }
  },
};
