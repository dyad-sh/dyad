import {
  DEFAULT_PTY_COMMAND_TIMEOUT_MS,
  PtyCommandExecutionError,
  runPtyCommand,
} from "@/ipc/utils/pty_command_runner";

export const SOCKET_FIREWALL_WARNING_MESSAGE =
  "the npm firewall could not be installed. Warning: can not check if npm packages are safe";
export const PNPM_MINIMUM_RELEASE_AGE_VERSION = "10.16.0";
export const MINIMUM_PACKAGE_RELEASE_AGE_DAYS = 1;
export const MINIMUM_PACKAGE_RELEASE_AGE_MINUTES =
  MINIMUM_PACKAGE_RELEASE_AGE_DAYS * 24 * 60;
export const PNPM_MINIMUM_RELEASE_AGE_WARNING_MESSAGE = `Install pnpm ${PNPM_MINIMUM_RELEASE_AGE_VERSION} or newer. Dyad uses npm fallback with a 1-day package release age gate, but pnpm ${PNPM_MINIMUM_RELEASE_AGE_VERSION}+ gives the best protection for app installs.`;
const SOCKET_FIREWALL_PACKAGE = "sfw@2.0.4";
const SOCKET_FIREWALL_NPX_ARGS = [
  "--prefer-offline",
  "--yes",
  SOCKET_FIREWALL_PACKAGE,
];
const WINDOWS_BATCH_COMMAND_PATTERN = /\.(cmd|bat)$/i;
const WINDOWS_CMD_NEEDS_QUOTING_PATTERN = /[\s"&|<>^%!()]/u;
export const SOCKET_FIREWALL_PROBE_TIMEOUT_MS = 30 * 1000;
export const PACKAGE_MANAGER_PROBE_TIMEOUT_MS = 30 * 1000;
export const ADD_DEPENDENCY_INSTALL_TIMEOUT_MS = DEFAULT_PTY_COMMAND_TIMEOUT_MS;

export interface CommandExecutionOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface CommandExecutionResult {
  stdout: string;
  stderr: string;
}

function buildCommandDisplay(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

export class CommandExecutionError extends Error {
  stdout: string;
  stderr: string;
  exitCode: number | null;

  constructor({
    message,
    stdout = "",
    stderr = "",
    exitCode = null,
  }: {
    message: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
  }) {
    super(message);
    this.name = "CommandExecutionError";
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandExecutionOptions,
) => Promise<CommandExecutionResult>;

export type PackageManager = "pnpm" | "npm";

function parseVersionParts(version: string): [number, number, number] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isVersionAtLeast(version: string, minimum: string): boolean {
  const parsedVersion = parseVersionParts(version);
  const parsedMinimum = parseVersionParts(minimum);
  if (!parsedVersion || !parsedMinimum) {
    return false;
  }

  for (let index = 0; index < parsedVersion.length; index += 1) {
    if (parsedVersion[index] > parsedMinimum[index]) {
      return true;
    }
    if (parsedVersion[index] < parsedMinimum[index]) {
      return false;
    }
  }

  return true;
}

export function resolveExecutableName(
  command: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32" && !command.includes(".")) {
    return `${command}.cmd`;
  }
  return command;
}

function quoteWindowsCmdArg(value: string): string {
  // `cmd.exe /d /s /c` strips an outer quoted command string, so simple args
  // stay unquoted while empty or shell-significant values are quoted/escaped.
  if (value !== "" && !WINDOWS_CMD_NEEDS_QUOTING_PATTERN.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

export function buildPtyInvocation(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  comSpec = process.env.ComSpec ?? "cmd.exe",
): { command: string; args: string[] } {
  const resolvedCommand = resolveExecutableName(command, platform);

  if (
    platform === "win32" &&
    WINDOWS_BATCH_COMMAND_PATTERN.test(resolvedCommand)
  ) {
    return {
      command: comSpec,
      args: [
        "/d",
        "/s",
        "/c",
        [resolvedCommand, ...args].map(quoteWindowsCmdArg).join(" "),
      ],
    };
  }

  return {
    command: resolvedCommand,
    args,
  };
}

export async function runCommand(
  command: string,
  args: string[],
  options: CommandExecutionOptions = {},
): Promise<CommandExecutionResult> {
  try {
    const invocation = buildPtyInvocation(command, args);
    const { output } = await runPtyCommand(
      invocation.command,
      invocation.args,
      {
        cwd: options.cwd,
        displayCommand: buildCommandDisplay(command, args),
        env: options.env,
        timeoutMs: options.timeoutMs,
      },
    );

    return {
      stdout: output,
      stderr: "",
    };
  } catch (error) {
    if (error instanceof PtyCommandExecutionError) {
      throw new CommandExecutionError({
        message: error.message,
        stdout: error.output,
        exitCode: error.exitCode,
      });
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new CommandExecutionError({
      message: `Failed to run command '${buildCommandDisplay(command, args)}': ${message}`,
    });
  }
}

export function getCommandExecutionDisplayDetails(
  error: unknown,
): string | undefined {
  if (!(error instanceof CommandExecutionError)) {
    return undefined;
  }

  const stderr = error.stderr.trim();
  if (stderr) {
    return stderr;
  }

  const stdout = error.stdout.trim();
  if (stdout) {
    return stdout;
  }

  return undefined;
}

export async function ensureSocketFirewallInstalled(
  runner: CommandRunner = runCommand,
): Promise<{
  available: boolean;
  warningMessage?: string;
}> {
  try {
    await runner("npx", [...SOCKET_FIREWALL_NPX_ARGS, "--help"], {
      timeoutMs: SOCKET_FIREWALL_PROBE_TIMEOUT_MS,
    });
    return { available: true };
  } catch {
    return {
      available: false,
      warningMessage: SOCKET_FIREWALL_WARNING_MESSAGE,
    };
  }
}

export async function detectPreferredPackageManager(
  runner: CommandRunner = runCommand,
): Promise<PackageManager> {
  const pnpmSupport = await getPnpmMinimumReleaseAgeSupport(runner);
  return pnpmSupport.supported ? "pnpm" : "npm";
}

export async function getPnpmMinimumReleaseAgeSupport(
  runner: CommandRunner = runCommand,
): Promise<{
  supported: boolean;
  version?: string;
  warningMessage?: string;
}> {
  try {
    const result = await runner("pnpm", ["--version"], {
      timeoutMs: PACKAGE_MANAGER_PROBE_TIMEOUT_MS,
    });
    const version = result.stdout.trim();
    if (isVersionAtLeast(version, PNPM_MINIMUM_RELEASE_AGE_VERSION)) {
      return { supported: true, version };
    }
    return {
      supported: false,
      version,
      warningMessage: PNPM_MINIMUM_RELEASE_AGE_WARNING_MESSAGE,
    };
  } catch {
    return {
      supported: false,
      warningMessage: PNPM_MINIMUM_RELEASE_AGE_WARNING_MESSAGE,
    };
  }
}

export function buildAddDependencyCommand(
  packages: string[],
  packageManager: PackageManager,
  useSocketFirewall: boolean,
  options: { dev?: boolean } = {},
): { command: string; args: string[] } {
  const { dev = false } = options;
  const pnpmAgeGateArgs = [
    `--config.minimumReleaseAge=${MINIMUM_PACKAGE_RELEASE_AGE_MINUTES}`,
    "--config.minimumReleaseAgeStrict=true",
  ];
  const npmAgeGateArgs = [
    `--min-release-age=${MINIMUM_PACKAGE_RELEASE_AGE_DAYS}`,
  ];
  const packageManagerArgs =
    packageManager === "pnpm"
      ? [...pnpmAgeGateArgs, "add", ...(dev ? ["-D"] : []), ...packages]
      : [
          "install",
          "--legacy-peer-deps",
          ...npmAgeGateArgs,
          ...(dev ? ["--save-dev"] : []),
          ...packages,
        ];

  if (useSocketFirewall) {
    return {
      // Use a pinned npx package so sfw stays reproducible and avoids global path issues on Windows.
      command: "npx",
      args: [
        ...SOCKET_FIREWALL_NPX_ARGS,
        packageManager,
        ...packageManagerArgs,
      ],
    };
  }

  return {
    command: packageManager,
    args: packageManagerArgs,
  };
}
