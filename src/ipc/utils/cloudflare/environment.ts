import { spawn } from "node:child_process";
import fs from "node:fs";
import nodePath from "node:path";
import os from "node:os";

import {
  parseCreatedDatabaseId,
  summariseWranglerError,
} from "@/lib/data_sources/wrangler_output";

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
      windowsHide: true,
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

/**
 * D1 databases visible to an API token.
 *
 * Uses Cloudflare's REST API rather than Wrangler: it needs no install, no
 * browser sign-in and no local state, and it is the same credential the
 * queries will use — so a token that lists databases is a token that works.
 */
export async function listD1Databases(apiToken: string): Promise<
  Array<{
    uuid: string;
    name: string;
    accountId: string;
    accountName: string;
    fileSizeBytes: number | null;
  }>
> {
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };

  const accountsResponse = await fetch(
    "https://api.cloudflare.com/client/v4/accounts",
    { headers, signal: AbortSignal.timeout(20_000) },
  );

  if (accountsResponse.status === 401 || accountsResponse.status === 403) {
    throw new Error(
      "Cloudflare rejected this API token. It needs permission to read accounts and D1.",
    );
  }
  if (!accountsResponse.ok) {
    throw new Error(`Cloudflare returned ${accountsResponse.status}.`);
  }

  const accounts = (
    (await accountsResponse.json()) as {
      result?: Array<{ id: string; name: string }>;
    }
  ).result;

  if (!accounts?.length) {
    throw new Error("This token can see no Cloudflare accounts.");
  }

  const databases: Array<{
    uuid: string;
    name: string;
    accountId: string;
    accountName: string;
    fileSizeBytes: number | null;
  }> = [];

  for (const account of accounts) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
        account.id,
      )}/d1/database`,
      { headers, signal: AbortSignal.timeout(20_000) },
    );
    // An account the token cannot read D1 in is skipped rather than failing
    // the whole list: tokens are often scoped to one account.
    if (!response.ok) continue;

    const result = (
      (await response.json()) as {
        result?: Array<{ uuid: string; name: string; file_size?: number }>;
      }
    ).result;

    for (const database of result ?? []) {
      databases.push({
        uuid: database.uuid,
        name: database.name,
        accountId: account.id,
        accountName: account.name,
        fileSizeBytes: database.file_size ?? null,
      });
    }
  }

  return databases;
}

/**
 * Installs Wrangler into the project, if it is not already usable.
 *
 * Project-local rather than global: a global install is shared state that this
 * app does not own, and removing it later would be someone else's problem.
 */
export async function ensureWrangler(projectRoot: string): Promise<string> {
  const existing = await run("npx", ["wrangler", "--version"], {
    cwd: projectRoot,
    timeoutMs: 45_000,
  });
  const found = parseWranglerVersion(existing.stdout + existing.stderr);
  if (existing.code === 0 && found) return found;

  const manager = detectPackageManager(projectRoot);
  const args: Record<PackageManager, string[]> = {
    npm: ["install", "--save-dev", "wrangler@latest"],
    pnpm: ["add", "-D", "wrangler@latest"],
    yarn: ["add", "-D", "wrangler@latest"],
    bun: ["add", "-d", "wrangler@latest"],
  };

  const install = await run(manager, args[manager], {
    cwd: projectRoot,
    timeoutMs: 300_000,
  });
  if (install.code !== 0) {
    throw new Error(
      `Could not install Wrangler with ${manager}. ${install.stderr.slice(0, 300)}`,
    );
  }

  const after = await run("npx", ["wrangler", "--version"], {
    cwd: projectRoot,
    timeoutMs: 45_000,
  });
  const version = parseWranglerVersion(after.stdout + after.stderr);
  if (!version) throw new Error("Wrangler installed but did not run.");
  return version;
}

/**
 * Browser sign-in.
 *
 * `wrangler login` prints an authorization URL and waits on a local callback.
 * The process is left running while the user approves in their browser, and
 * success is confirmed by asking who we are afterwards rather than by trusting
 * the exit code — a cancelled sign-in can exit zero.
 */
export async function loginWithBrowser(
  projectRoot: string,
): Promise<{ email: string | null; accountId: string | null }> {
  const login = await run("npx", ["wrangler", "login"], {
    cwd: projectRoot,
    // Long enough for a person to find the browser window and approve.
    timeoutMs: 240_000,
  });

  const whoami = await run("npx", ["wrangler", "whoami"], {
    cwd: projectRoot,
    timeoutMs: 45_000,
  });
  const account = parseWhoami(whoami.stdout + whoami.stderr);

  if (!account) {
    throw new Error(
      login.code === 0
        ? "Cloudflare sign-in did not complete. The browser window may have been closed before approving."
        : "Cloudflare sign-in failed.",
    );
  }
  return account;
}

/** D1 databases visible to the signed-in account, via Wrangler. */
export async function listD1DatabasesViaWrangler(
  projectRoot: string,
): Promise<Array<{ uuid: string; name: string }>> {
  const result = await run("npx", ["wrangler", "d1", "list", "--json"], {
    cwd: projectRoot,
    timeoutMs: 60_000,
  });

  if (result.code !== 0) {
    throw new Error(
      /not authenticated|not logged in/i.test(result.stdout + result.stderr)
        ? "Cloudflare is not signed in."
        : "Could not list D1 databases.",
    );
  }

  // Wrangler prints a banner before the JSON on some versions, so the array is
  // located rather than assumed to start at the first character.
  const text = result.stdout;
  const start = text.indexOf("[");
  if (start < 0) return [];

  try {
    const parsed = JSON.parse(text.slice(start)) as Array<{
      uuid?: string;
      name?: string;
    }>;
    return parsed
      .filter((row) => row.uuid && row.name)
      .map((row) => ({ uuid: row.uuid as string, name: row.name as string }));
  } catch {
    throw new Error("Could not read the list of D1 databases.");
  }
}

/**
 * One read-only statement, through Wrangler, against the remote database.
 *
 * `--remote` matters: without it Wrangler queries a local simulation, which
 * would answer confidently about data that is not there.
 */
export async function executeD1ViaWrangler(input: {
  projectRoot: string;
  databaseId: string;
  sql: string;
}): Promise<Array<Record<string, unknown>>> {
  const result = await run(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      input.databaseId,
      "--remote",
      "--json",
      "--command",
      input.sql,
    ],
    { cwd: input.projectRoot, timeoutMs: 60_000 },
  );

  if (result.code !== 0) {
    throw new Error(
      /not authenticated|not logged in/i.test(result.stdout + result.stderr)
        ? "Cloudflare is not signed in."
        : "The query could not be run.",
    );
  }

  const start = result.stdout.indexOf("[");
  if (start < 0) return [];

  try {
    const parsed = JSON.parse(result.stdout.slice(start)) as Array<{
      results?: Array<Record<string, unknown>>;
    }>;
    return parsed[0]?.results ?? [];
  } catch {
    throw new Error("Could not read the query results.");
  }
}

/**
 * Creates a D1 database through Wrangler, for the browser-signed-in path.
 *
 * The name is passed as an argument rather than interpolated, and has already
 * been restricted to letters, digits, hyphens and underscores before it gets
 * here.
 */
export async function createD1ViaWrangler(input: {
  projectRoot: string;
  name: string;
}): Promise<{ uuid: string; name: string; accountId: string | null }> {
  // No --json here: wrangler d1 create does not accept it, and passing it made
  // every creation fail with an unknown-argument error that never reached the
  // user. The id is read from the binding block it prints instead.
  const result = await run("npx", ["wrangler", "d1", "create", input.name], {
    cwd: input.projectRoot,
    timeoutMs: 120_000,
  });

  const output = result.stdout + result.stderr;

  if (result.code !== 0) {
    if (/already exists/i.test(output)) {
      throw new Error(`A database called ${input.name} already exists.`);
    }
    if (/not authenticated|not logged in/i.test(output)) {
      throw new Error("Cloudflare is not signed in.");
    }
    // Cloudflare's own words, when it has any. A generic message here is what
    // made this hard to diagnose the first time.
    const detail = summariseWranglerError(output);
    throw new Error(
      detail
        ? `Cloudflare would not create that database: ${detail}`
        : "Cloudflare would not create that database.",
    );
  }

  const uuid = parseCreatedDatabaseId(output);
  if (!uuid) {
    throw new Error(
      "The database was created but Cloudflare did not report its id. Look for it in the list.",
    );
  }

  return { uuid, name: input.name, accountId: null };
}

/** Creates a D1 database through the REST API, for the token path. */
export async function createD1ViaToken(input: {
  apiToken: string;
  accountId: string;
  name: string;
}): Promise<{ uuid: string; name: string; accountId: string }> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
      input.accountId,
    )}/d1/database`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: input.name }),
      signal: AbortSignal.timeout(60_000),
    },
  );

  const payload = (await response.json().catch(() => null)) as {
    success?: boolean;
    result?: { uuid?: string; name?: string };
    errors?: Array<{ message: string }>;
  } | null;

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "This token is not permitted to create databases. It needs D1 edit access.",
    );
  }
  if (!response.ok || !payload?.success || !payload.result?.uuid) {
    const detail = payload?.errors?.map((error) => error.message).join("; ");
    throw new Error(
      /already exists/i.test(detail ?? "")
        ? `A database called ${input.name} already exists.`
        : detail || "Cloudflare would not create that database.",
    );
  }

  return {
    uuid: payload.result.uuid,
    name: payload.result.name ?? input.name,
    accountId: input.accountId,
  };
}

/**
 * Runs statements that change a database, through Wrangler.
 *
 * Deliberately separate from the read path: that one refuses anything but a
 * SELECT, and this one exists so creating tables does not require weakening
 * it. It is only reachable from schema application, after a person has seen
 * and approved the design.
 */
export async function applyD1Statements(input: {
  projectRoot: string;
  databaseId: string;
  statements: string[];
}): Promise<number> {
  let applied = 0;

  for (const statement of input.statements) {
    const result = await run(
      "npx",
      [
        "wrangler",
        "d1",
        "execute",
        input.databaseId,
        "--remote",
        "--yes",
        "--command",
        statement,
      ],
      { cwd: input.projectRoot, timeoutMs: 120_000 },
    );

    if (result.code !== 0) {
      const detail = summariseWranglerError(result.stdout + result.stderr);
      throw new Error(
        detail
          ? `Could not create the tables: ${detail}`
          : "Could not create the tables.",
      );
    }
    applied += 1;
  }

  return applied;
}
