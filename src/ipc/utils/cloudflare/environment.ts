import { spawn } from "node:child_process";
import fs from "node:fs";
import nodePath from "node:path";
import os from "node:os";

/**
 * What is already on this machine, before anything is installed.
 *
 * Every command here is run with an argument array rather than a shell string.
 * Database and resource names reach these calls later in the flow, and a name
 * concatenated into a shell command is a way to run anything.
 *
 * Nothing in this file changes the machine. Detection and installation are
 * separated so the user can be shown what was found before anything is done
 * about it.
 */

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export type CloudflareEnvironment = {
  platform: string;
  arch: string;
  nodeVersion: string | null;
  /** The manager this project actually uses, from its lockfile. */
  packageManager: PackageManager;
  wranglerVersion: string | null;
  /** Cloudflare account email, when already authenticated. */
  account: { email: string | null; accountId: string | null } | null;
  /** True when an API token is present in the environment. */
  hasApiToken: boolean;
};

/** Runs a command without a shell, capturing output. Never throws. */
export function run(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      // No shell: arguments stay arguments, whatever they contain.
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(
      () => child.kill("SIGKILL"),
      options.timeoutMs ?? 60_000,
    );

    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * The project's package manager, from whichever lockfile is present.
 *
 * Read rather than chosen: installing with npm into a pnpm project produces a
 * second lockfile and a support problem.
 */
export function detectPackageManager(projectRoot: string): PackageManager {
  const lockfiles: Array<[string, PackageManager]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ];
  for (const [file, manager] of lockfiles) {
    if (fs.existsSync(nodePath.join(projectRoot, file))) return manager;
  }
  return "npm";
}

/** The version from `wrangler --version` output, or null if unreadable. */
export function parseWranglerVersion(output: string): string | null {
  // Wrangler prints varying shapes across versions: "⛅️ wrangler 3.90.0",
  // "wrangler 4.0.0", or a bare semver. Take the first semver present.
  const match = output.match(/\d+\.\d+\.\d+(?:-[\w.]+)?/);
  return match ? match[0] : null;
}

/**
 * Account details from `wrangler whoami`.
 *
 * Returns null when the output does not show an authenticated account, which
 * is how "not logged in" is distinguished from "logged in, unparsed".
 */
export function parseWhoami(
  output: string,
): { email: string | null; accountId: string | null } | null {
  if (/not authenticated|you are not logged in/i.test(output)) return null;

  const email = output.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null;
  // Account ids are 32 hex characters, printed in a table beside the name.
  const accountId = output.match(/\b[0-9a-f]{32}\b/i)?.[0] ?? null;

  if (!email && !accountId) return null;
  return { email, accountId };
}

/** Everything detectable about this machine's Cloudflare readiness. */
export async function detectCloudflareEnvironment(
  projectRoot: string,
): Promise<CloudflareEnvironment> {
  const packageManager = detectPackageManager(projectRoot);

  const [nodeResult, wranglerResult] = await Promise.all([
    run("node", ["--version"], { timeoutMs: 10_000 }),
    run("npx", ["wrangler", "--version"], {
      cwd: projectRoot,
      timeoutMs: 45_000,
    }),
  ]);

  const wranglerVersion =
    wranglerResult.code === 0
      ? parseWranglerVersion(wranglerResult.stdout + wranglerResult.stderr)
      : null;

  // Only ask who we are if there is something to ask with.
  let account: CloudflareEnvironment["account"] = null;
  if (wranglerVersion) {
    const whoami = await run("npx", ["wrangler", "whoami"], {
      cwd: projectRoot,
      timeoutMs: 45_000,
    });
    account = parseWhoami(whoami.stdout + whoami.stderr);
  }

  return {
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion:
      nodeResult.code === 0 ? nodeResult.stdout.trim() || null : null,
    packageManager,
    wranglerVersion,
    account,
    // Presence only. The value is never read here and never leaves the machine.
    hasApiToken: Boolean(process.env.CLOUDFLARE_API_TOKEN),
  };
}
