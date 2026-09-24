import path from "node:path";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { getDyadAppPath } from "@/paths/paths";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { assertDockerAvailable } from "@/ipc/services/docker_runtime/docker_cli";
import {
  appGuestInput,
  runGuestBuffered,
  toGuestPath,
} from "@/ipc/services/docker_runtime/guest_command";
import type { BufferedProcessResult } from "@/ipc/utils/buffered_process";
import {
  buildUpdateDependencyCommand,
  CommandExecutionError,
  type CommandExecutionResult,
} from "@/ipc/utils/socket_firewall";

/**
 * Package-manager commands for Docker mode. Installs run dependency lifecycle
 * scripts, so they execute in the guest against the app's node_modules
 * volume; `package.json`, lockfiles, and `pnpm-workspace.yaml` come back
 * through the bind mount for the host to read as data.
 */

export interface PackageManagerInvocation {
  command: string;
  args: string[];
}

/**
 * Callers that only have the app's path (add-dependency, upgrades) resolve
 * the app ID the guest needs from the apps table.
 */
export async function resolveAppIdForPath(appPath: string): Promise<number> {
  const target = path.resolve(appPath);
  const rows = await db.select({ id: apps.id, path: apps.path }).from(apps);
  const match = rows.find(
    (row) => path.resolve(getDyadAppPath(row.path)) === target,
  );
  if (!match) {
    throw new DyadError(
      `No Dyad app found at ${appPath}`,
      DyadErrorKind.NotFound,
    );
  }
  return match.id;
}

const SOCKET_FIREWALL_UNAVAILABLE_MARKER =
  "__DYAD_SOCKET_FIREWALL_UNAVAILABLE__";
const SAFE_SHELL_TOKEN_PATTERN = /^[A-Za-z0-9@._=:/-]+$/;

/**
 * socket_firewall.ts keeps the pinned `npx … sfw@<version>` prefix private;
 * recover it from its own wrapper so host and guest stay on one version.
 */
function getSocketFirewallNpxArgs(): string[] {
  const plain = buildUpdateDependencyCommand([], "pnpm", false);
  const wrapped = buildUpdateDependencyCommand([], "pnpm", true);
  return wrapped.args.slice(0, wrapped.args.length - plain.args.length - 1);
}

/**
 * Runs the command under the Socket firewall inside the guest, matching the
 * host policy. Like the host (which probes `sfw --help` first), an
 * unavailable firewall falls back to the bare command and prints a marker so
 * the caller can surface the same warning. The probe and the install share
 * one container, and the command's own argv is passed through `"$@"`, never
 * interpolated into the script.
 */
export function wrapWithGuestSocketFirewall(
  invocation: PackageManagerInvocation,
): PackageManagerInvocation {
  const npxArgs = getSocketFirewallNpxArgs();
  if (!npxArgs.every((arg) => SAFE_SHELL_TOKEN_PATTERN.test(arg))) {
    throw new DyadError(
      `Unexpected Socket firewall arguments: ${npxArgs.join(" ")}`,
      DyadErrorKind.Internal,
    );
  }
  const npx = ["npx", ...npxArgs].join(" ");
  const script = `if ${npx} --help >/dev/null 2>&1; then exec ${npx} "$@"; fi; echo ${SOCKET_FIREWALL_UNAVAILABLE_MARKER}; exec "$@"`;
  return {
    command: "sh",
    args: ["-c", script, "sh", invocation.command, ...invocation.args],
  };
}

function stripSocketFirewallMarker(output: string): {
  output: string;
  found: boolean;
} {
  if (!output.includes(SOCKET_FIREWALL_UNAVAILABLE_MARKER)) {
    return { output, found: false };
  }
  return {
    output: output
      .split("\n")
      .filter((line) => line.trim() !== SOCKET_FIREWALL_UNAVAILABLE_MARKER)
      .join("\n"),
    found: true,
  };
}

function describeFailure(result: BufferedProcessResult): string {
  if (result.timedOut) return "timed out";
  if (result.aborted) return "was cancelled";
  if (result.signal) return `terminated by signal ${result.signal}`;
  return `exit code ${result.code}`;
}

/**
 * Guest counterpart of `runCommand`: resolves with the output on success and
 * throws `CommandExecutionError` otherwise, so callers keep their error
 * classification and display logic.
 */
export async function runPackageManagerCommandInGuest({
  appId,
  appPath,
  invocation,
  useSocketFirewall = false,
  timeoutMs,
  onSocketFirewallUnavailable,
}: {
  appId: number;
  appPath: string;
  /** The bare package-manager command, without any firewall wrapper. */
  invocation: PackageManagerInvocation;
  useSocketFirewall?: boolean;
  timeoutMs?: number;
  onSocketFirewallUnavailable?: () => void;
}): Promise<CommandExecutionResult> {
  const display = [invocation.command, ...invocation.args].join(" ");
  const guestInvocation = useSocketFirewall
    ? wrapWithGuestSocketFirewall(invocation)
    : invocation;
  await assertDockerAvailable();

  let result: BufferedProcessResult;
  try {
    result = await runGuestBuffered(
      await appGuestInput({
        appId,
        appPath,
        command: guestInvocation.command,
        args: guestInvocation.args,
        env: {
          // Persists the npx cache (the pinned Socket firewall) across the
          // throwaway guest containers.
          npm_config_cache: `${toGuestPath(appPath)}/node_modules/.npm-cache`,
        },
      }),
      { timeoutMs },
    );
  } catch (error) {
    if (isDyadError(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new CommandExecutionError({
      message: `Failed to run command '${display}' in the Docker runtime: ${message}`,
    });
  }

  const stdout = stripSocketFirewallMarker(result.stdout);
  if (stdout.found) {
    onSocketFirewallUnavailable?.();
  }
  if (result.code === 0 && !result.timedOut && !result.aborted) {
    return { stdout: stdout.output, stderr: result.stderr };
  }
  throw new CommandExecutionError({
    message: `Command '${display}' failed in the Docker runtime (${describeFailure(result)})`,
    stdout: stdout.output,
    stderr: result.stderr,
    exitCode: result.code,
  });
}
