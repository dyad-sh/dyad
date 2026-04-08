import { spawn } from "node:child_process";

export const SOCKET_FIREWALL_WARNING_MESSAGE =
  "the npm firewall could not be installed. Warning: can not check if npm packages are safe";
const SOCKET_FIREWALL_PACKAGE = "sfw@2.0.4";

export interface CommandExecutionOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface CommandExecutionResult {
  stdout: string;
  stderr: string;
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

export function shouldUseCommandShell(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32";
}

export function resolveExecutableName(command: string): string {
  if (process.platform === "win32" && !command.includes(".")) {
    return `${command}.cmd`;
  }
  return command;
}

export async function runCommand(
  command: string,
  args: string[],
  options: CommandExecutionOptions = {},
): Promise<CommandExecutionResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveExecutableName(command), args, {
      cwd: options.cwd,
      env: options.env,
      shell: shouldUseCommandShell(),
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(
        new CommandExecutionError({
          message: `Failed to run command '${command} ${args.join(" ")}': ${error.message}`,
          stdout,
          stderr,
        }),
      );
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new CommandExecutionError({
          message: `Command '${command} ${args.join(" ")}' exited with code ${code ?? "unknown"}`,
          stdout,
          stderr,
          exitCode: code,
        }),
      );
    });
  });
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
    await runner("npx", [SOCKET_FIREWALL_PACKAGE, "--help"]);
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
  try {
    await runner("pnpm", ["--version"]);
    return "pnpm";
  } catch {
    return "npm";
  }
}

export function buildAddDependencyCommand(
  packages: string[],
  packageManager: PackageManager,
  useSocketFirewall: boolean,
): { command: string; args: string[] } {
  const packageManagerArgs =
    packageManager === "pnpm"
      ? ["add", ...packages]
      : ["install", "--legacy-peer-deps", ...packages];

  if (useSocketFirewall) {
    return {
      // Use a pinned npx package so sfw stays reproducible and avoids global path issues on Windows.
      command: "npx",
      args: [SOCKET_FIREWALL_PACKAGE, packageManager, ...packageManagerArgs],
    };
  }

  return {
    command: packageManager,
    args: packageManagerArgs,
  };
}
