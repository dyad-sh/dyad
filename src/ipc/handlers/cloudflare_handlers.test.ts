import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { apps, cloudflareAppConnections } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";

/**
 * Setting up a deployment is a chain of calls against two services, any of
 * which can refuse. These run the real handlers and the real migrations
 * against a stand-in for Cloudflare and GitHub, and check what is left behind
 * on each side when the chain finishes or breaks.
 */

const holder = vi.hoisted(() => ({
  db: undefined as unknown,
  settings: {} as Record<string, unknown>,
  committedFiles: [] as string[],
  refs: {} as Record<string, string>,
  files: {} as Record<string, string>,
  githubCalls: 0,
  githubOffline: false,
  githubStatus: null as number | null,
  localPnpmVersion: "11.4.2" as string | undefined,
}));

vi.mock("../../db", () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock("../../main/settings", () => ({
  readSettings: () => ({ ...holder.settings }),
  writeSettings: (patch: Record<string, unknown>) => {
    Object.assign(holder.settings, patch);
  },
}));

vi.mock("@/paths/paths", () => ({
  getDyadAppPath: (appPath: string) => `/apps/${appPath}`,
}));

vi.mock("./github_handlers", () => ({
  getGitHubApiBase: () => "https://github.test",
}));

vi.mock("../utils/git_utils", () => ({
  execGit: async (
    args: string[],
    _path: string,
    options?: { stdin?: string },
  ) => {
    if (args[0] === "cat-file") {
      // One NUL-terminated "<ref>:<path>" per entry on stdin; each answers
      // with a size header and the bytes, or "missing", NUL-terminated.
      // Bytes come back as latin1, as asked.
      const stdout = (options?.stdin ?? "")
        .split("\0")
        .filter(Boolean)
        .map((name) => {
          const contents = holder.files[name.slice(name.indexOf(":") + 1)];
          if (contents === undefined) return `${name} missing\0`;
          const bytes = Buffer.from(contents, "utf8");
          return `abc123 blob ${bytes.length}\0${bytes.toString("latin1")}\0`;
        })
        .join("");
      return { exitCode: 0, stdout, stderr: "" };
    }
    if (args[0] === "ls-tree") {
      // As git does, fails for a branch that does not exist locally.
      return holder.refs[args[args.length - 1]]
        ? { exitCode: 0, stdout: holder.committedFiles.join("\0"), stderr: "" }
        : { exitCode: 128, stdout: "", stderr: "Not a valid object name" };
    }
    if (args[0] === "show") {
      // "refs/heads/<branch>:<path>", the file as committed on the branch.
      const contents = holder.files[args[1].slice(args[1].indexOf(":") + 1)];
      return contents === undefined
        ? { exitCode: 128, stdout: "", stderr: "does not exist" }
        : { exitCode: 0, stdout: contents, stderr: "" };
    }
    if (args[0] === "rev-parse") {
      const sha = holder.refs[args[args.length - 1]];
      return sha
        ? { exitCode: 0, stdout: `${sha}\n`, stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  },
}));

vi.mock("../utils/socket_firewall", () => ({
  getPnpmMinimumReleaseAgeSupport: async () => ({
    available: holder.localPnpmVersion !== undefined,
    minimumReleaseAgeSupported: true,
    version: holder.localPnpmVersion,
  }),
}));

// A stand-in Neon: what the chosen branch resolves to, and which origins the
// sync asked it to trust.
const neon = vi.hoisted(() => ({
  resolved: {
    databaseUrl: "postgres://db.neon.test/app",
    neonAuthBaseUrl: "https://auth.neon.test/app/auth" as string | undefined,
    neonAuthCookieSecret: undefined as string | undefined,
    branchId: "br-prod",
    isNextJs: false,
  },
  resolveError: null as Error | null,
  branchTypes: [] as string[],
  trustedOrigins: [] as string[],
  trustError: null as Error | null,
}));
vi.mock("../utils/neon_utils", () => ({
  combineWarnings: (...warnings: Array<string | undefined>) => {
    const kept = warnings.filter(Boolean);
    return kept.length > 0 ? kept.join(" ") : undefined;
  },
  getSelectedDeployBranchType: (app: {
    selectedDatabaseBranchType?: unknown;
  }) =>
    app.selectedDatabaseBranchType === "development"
      ? "development"
      : "production",
  resolveNeonBranchEnvVars: async ({ branchType }: { branchType: string }) => {
    if (neon.resolveError) throw neon.resolveError;
    neon.branchTypes.push(branchType);
    return neon.resolved;
  },
  ensureNeonAuthTrustedDomain: async ({ origin }: { origin: string }) => {
    if (neon.trustError) throw neon.trustError;
    if (neon.trustedOrigins.includes(origin)) return null;
    neon.trustedOrigins.push(origin);
    return origin;
  },
}));

const { cloudflareHandlersForTesting: handlers } =
  await import("./cloudflare_handlers");
const { syncNeonConfigToCloudflare, removeNeonEnvVarsFromCloudflare } =
  await import("../utils/cloudflare_neon_sync");

// ---------------------------------------------------------------------------
// A stand-in Cloudflare
// ---------------------------------------------------------------------------

const ACCOUNT = "acct-1";
const TOKEN = "cf-token";
const TOKEN_ID = "token-id-1";

interface FakeTrigger {
  trigger_uuid: string;
  external_script_id: string;
  repo_connection_uuid: string;
  build_token_uuid: string;
  branch_includes: string[];
  repo_connection?: { repo_name: string; provider_account_name: string };
  [key: string]: unknown;
}

interface FakeCloudflare {
  tokenStatus: string;
  canUseBuilds: boolean;
  subdomain: string | null;
  visibleRepoIds: Set<string>;
  workers: Map<string, { tag: string; routeEnabled: boolean }>;
  /** Each Worker's runtime secrets by name. */
  secrets: Record<string, Record<string, string>>;
  buildTokens: { build_token_uuid: string; cloudflare_token_id: string }[];
  triggers: FakeTrigger[];
  builds: Record<string, unknown>[];
  logs: Record<string, [number, string][]>;
  startedBuilds: string[];
  buildVariables: Record<string, Record<string, unknown>>;
  failOn: ((method: string, path: string) => boolean) | null;
  /** The status a simulated failure answers with. */
  failStatus: number;
  calls: string[];
}

let cloudflare: FakeCloudflare;
const repoConnections: Record<
  string,
  { repo_name: string; provider_account_name: string }
> = {};
let nextId = 0;
const id = (prefix: string) => `${prefix}-${++nextId}`;

function ok(result: unknown) {
  return new Response(JSON.stringify({ success: true, errors: [], result }));
}
function fail(status: number, code: number, message: string) {
  return new Response(
    JSON.stringify({ success: false, errors: [{ code, message }] }),
    { status },
  );
}

async function fakeFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";

  if (url.origin === "https://github.test") {
    holder.githubCalls += 1;
    if (holder.githubOffline) throw new TypeError("fetch failed");
    if (holder.githubStatus !== null) {
      return new Response("{}", { status: holder.githubStatus });
    }
    const headers = new Headers(init?.headers);
    if (headers.get("authorization") !== "Bearer gh-token") {
      return new Response(JSON.stringify({ message: "Bad credentials" }), {
        status: 401,
      });
    }
    if (method !== "GET" || url.pathname !== "/repos/acme/shop") {
      return new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
      });
    }
    return new Response(
      JSON.stringify({
        id: 501,
        name: "shop",
        owner: { id: 77, login: "acme" },
      }),
    );
  }

  const path = url.pathname.replace("/client/v4", "");
  cloudflare.calls.push(`${method} ${path}`);
  if (cloudflare.failOn?.(method, path)) {
    return fail(cloudflare.failStatus, 1, "simulated failure");
  }
  const body =
    typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  const account = `/accounts/${ACCOUNT}`;
  let match: RegExpExecArray | null;

  if (path === "/user/tokens/verify") {
    return ok({ id: TOKEN_ID, status: cloudflare.tokenStatus });
  }
  if (path === "/accounts") {
    return ok([{ id: ACCOUNT, name: "Acme" }]);
  }
  if (path === `${account}/workers/subdomain`) {
    return cloudflare.subdomain
      ? ok({ subdomain: cloudflare.subdomain })
      : fail(404, 10007, "no subdomain");
  }
  if (path === `${account}/workers/scripts` && method === "GET") {
    return ok(
      [...cloudflare.workers].map(([name, worker]) => ({
        id: name,
        tag: worker.tag,
      })),
    );
  }
  if ((match = /\/workers\/scripts\/([^/]+)\/subdomain$/.exec(path))) {
    const worker = cloudflare.workers.get(match[1])!;
    if (method === "POST") {
      worker.routeEnabled = true;
    }
    return ok({ enabled: worker.routeEnabled });
  }
  if (
    (match = /\/workers\/scripts\/([^/]+)\/secrets$/.exec(path)) &&
    method === "PUT"
  ) {
    if (!cloudflare.workers.has(match[1])) {
      return fail(404, 10007, "workers.api.error.script_not_found");
    }
    cloudflare.secrets[match[1]] = {
      ...cloudflare.secrets[match[1]],
      [body.name]: body.text,
    };
    return ok({ name: body.name, type: body.type });
  }
  if (
    (match = /\/workers\/scripts\/([^/]+)\/secrets\/([^/]+)$/.exec(path)) &&
    method === "DELETE"
  ) {
    const secrets = cloudflare.secrets[match[1]];
    if (!secrets || !(match[2] in secrets)) {
      return fail(404, 10056, "binding not found");
    }
    delete secrets[match[2]];
    return ok(null);
  }
  if ((match = /\/workers\/scripts\/([^/]+)$/.exec(path))) {
    if (method === "PUT") {
      const worker = { tag: id("tag"), routeEnabled: false };
      cloudflare.workers.set(match[1], worker);
      return ok({ tag: worker.tag });
    }
    if (method === "DELETE") {
      cloudflare.workers.delete(match[1]);
      return ok(null);
    }
  }
  if (path.startsWith(`${account}/builds/`) && !cloudflare.canUseBuilds) {
    return fail(403, 10000, "Authentication error");
  }
  if (
    (match = /\/builds\/repos\/github\/\d+\/(\d+)\/config_autofill$/.exec(path))
  ) {
    return cloudflare.visibleRepoIds.has(match[1])
      ? ok({ scripts: {} })
      : fail(404, 12000, "Not found");
  }
  if (path === `${account}/builds/repos/connections`) {
    repoConnections[`conn-${body.repo_id}`] = {
      repo_name: body.repo_name,
      provider_account_name: body.provider_account_name,
    };
    return ok({ repo_connection_uuid: `conn-${body.repo_id}` });
  }
  if (path === `${account}/builds/tokens`) {
    if (method === "GET") return ok(cloudflare.buildTokens);
    const created = {
      build_token_uuid: id("build-token"),
      cloudflare_token_id: body.cloudflare_token_id,
    };
    cloudflare.buildTokens.push(created);
    return ok(created);
  }
  if ((match = /\/builds\/workers\/([^/]+)\/triggers$/.exec(path))) {
    return ok(
      cloudflare.triggers.filter(
        (trigger) => trigger.external_script_id === match![1],
      ),
    );
  }
  if (path === `${account}/builds/triggers` && method === "POST") {
    // As Cloudflare does: a Worker takes one rule for named branches and one
    // preview rule, and refuses another of either kind.
    const isPreview = (rule: { branch_includes?: string[] }) =>
      (rule.branch_includes ?? []).includes("*");
    const clash = cloudflare.triggers.some(
      (existing) =>
        existing.external_script_id === body.external_script_id &&
        isPreview(existing) === isPreview(body),
    );
    if (clash) {
      return fail(
        409,
        12042,
        "A trigger already exists for this configuration",
      );
    }
    const trigger = {
      ...body,
      trigger_uuid: id("trigger"),
      repo_connection: repoConnections[body.repo_connection_uuid],
    } as FakeTrigger;
    cloudflare.triggers.push(trigger);
    return ok(trigger);
  }
  if (
    (match = /\/builds\/triggers\/([^/]+)\/environment_variables$/.exec(path))
  ) {
    cloudflare.buildVariables[match[1]] = {
      ...cloudflare.buildVariables[match[1]],
      ...body,
    };
    return ok(cloudflare.buildVariables[match[1]]);
  }
  if ((match = /\/builds\/triggers\/([^/]+)\/builds$/.exec(path))) {
    cloudflare.startedBuilds.push(match[1]);
    return ok({ build_uuid: id("build"), status: "queued" });
  }
  if ((match = /\/builds\/triggers\/([^/]+)$/.exec(path))) {
    const index = cloudflare.triggers.findIndex(
      (trigger) => trigger.trigger_uuid === match![1],
    );
    if (index === -1) return fail(404, 12000, "Not found");
    if (method === "DELETE") cloudflare.triggers.splice(index, 1);
    if (method === "PATCH") Object.assign(cloudflare.triggers[index], body);
    return ok(cloudflare.triggers[index] ?? null);
  }
  if (/\/builds\/workers\/[^/]+\/builds$/.test(path)) {
    return ok(cloudflare.builds);
  }
  if ((match = /\/builds\/builds\/([^/]+)\/logs$/.exec(path))) {
    return ok({ lines: cloudflare.logs[match[1]] ?? [] });
  }
  throw new Error(`fake Cloudflare has no route for ${method} ${path}`);
}

// ---------------------------------------------------------------------------

let db: TestDb;
let appId: number;

const CONNECT = {
  accountId: ACCOUNT,
  rootDirectory: "worker",
  workerName: "shop-api",
  mode: "create" as const,
};

function connectionRows() {
  return db
    .select()
    .from(cloudflareAppConnections)
    .where(eq(cloudflareAppConnections.appId, appId))
    .all();
}

beforeEach(() => {
  nextId = 0;
  db = createInMemoryTestDb();
  holder.db = db;
  holder.settings = {
    cloudflareAccessToken: { value: TOKEN },
    githubAccessToken: { value: "gh-token" },
  };
  holder.committedFiles = ["package.json", "worker/wrangler.jsonc"];
  holder.refs = {
    "refs/heads/main": "sha-1",
    "refs/remotes/origin/main": "sha-1",
  };
  holder.localPnpmVersion = "11.4.2";
  holder.githubCalls = 0;
  holder.githubOffline = false;
  holder.githubStatus = null;
  handlers.clearGithubIdentityCache();
  holder.files = {
    "worker/wrangler.jsonc": `{ "name": "shop-api" }`,
  };
  neon.resolved = {
    databaseUrl: "postgres://db.neon.test/app",
    neonAuthBaseUrl: "https://auth.neon.test/app/auth",
    neonAuthCookieSecret: undefined,
    branchId: "br-prod",
    isNextJs: false,
  };
  neon.resolveError = null;
  neon.branchTypes = [];
  neon.trustedOrigins = [];
  neon.trustError = null;
  cloudflare = {
    tokenStatus: "active",
    canUseBuilds: true,
    subdomain: "acme",
    visibleRepoIds: new Set(["501"]),
    workers: new Map(),
    secrets: {},
    buildTokens: [],
    triggers: [],
    builds: [],
    logs: {},
    startedBuilds: [],
    buildVariables: {},
    failOn: null,
    failStatus: 500,
    calls: [],
  };
  vi.stubGlobal("fetch", fakeFetch);
  appId = db
    .insert(apps)
    .values({
      name: "Shop",
      path: "shop",
      githubOrg: "acme",
      githubRepo: "shop",
    })
    .returning({ id: apps.id })
    .get().id;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("connecting a new Worker", () => {
  it("creates the Worker, the deploy rule and the row, then starts a build", async () => {
    const result = await handlers.handleConnectWorker({ appId, ...CONNECT });

    expect(result).toMatchObject({
      status: "connected",
      connection: {
        rootDirectory: "worker",
        workerName: "shop-api",
        workerUrl: "https://shop-api.acme.workers.dev",
      },
    });
    expect(cloudflare.workers.get("shop-api")?.routeEnabled).toBe(true);
    expect(cloudflare.triggers).toHaveLength(1);
    const [trigger] = cloudflare.triggers;
    expect(trigger).toMatchObject({
      external_script_id: cloudflare.workers.get("shop-api")!.tag,
      repo_connection_uuid: "conn-501",
      build_token_uuid: cloudflare.buildTokens[0].build_token_uuid,
      root_directory: "/worker",
      path_includes: ["worker/*"],
      branch_includes: ["main"],
      // The fixture folder has no package.json, so there is nothing to build.
      build_command: "",
      deploy_command: "npx wrangler deploy --name shop-api",
    });
    expect(cloudflare.startedBuilds).toEqual([trigger.trigger_uuid]);
    expect(connectionRows()).toEqual([
      expect.objectContaining({
        rootDirectory: "worker",
        accountId: ACCOUNT,
        workerTag: trigger.external_script_id,
        triggerUuid: trigger.trigger_uuid,
      }),
    ]);
  });

  it("builds first when the folder has a build script", async () => {
    holder.files["worker/package.json"] = JSON.stringify({
      scripts: { build: "tsc" },
    });
    await handlers.handleConnectWorker({ appId, ...CONNECT });
    expect(cloudflare.triggers[0].build_command).toBe("npm run build");
  });

  it("follows the branch the app syncs to", async () => {
    db.update(apps).set({ githubBranch: "release" }).run();
    holder.refs["refs/heads/release"] = "sha-9";
    holder.refs["refs/remotes/origin/release"] = "sha-9";
    await handlers.handleConnectWorker({ appId, ...CONNECT });
    expect(cloudflare.triggers[0].branch_includes).toEqual(["release"]);
  });

  it("registers the API token for builds once and reuses it afterwards", async () => {
    await handlers.handleConnectWorker({ appId, ...CONNECT });
    holder.committedFiles.push("cron/wrangler.toml");
    await handlers.handleConnectWorker({
      appId,
      ...CONNECT,
      rootDirectory: "cron",
      workerName: "shop-cron",
    });

    expect(cloudflare.buildTokens).toEqual([
      expect.objectContaining({ cloudflare_token_id: TOKEN_ID }),
    ]);
    expect(
      connectionRows()
        .map((row) => row.rootDirectory)
        .sort(),
    ).toEqual(["cron", "worker"]);
  });

  it("still connects when only the first build fails to start", async () => {
    cloudflare.failOn = (method, path) =>
      method === "POST" && path.endsWith("/builds");
    const result = await handlers.handleConnectWorker({ appId, ...CONNECT });

    expect(result.status).toBe("connected");
    expect(result.status === "connected" && result.warning).toMatch(
      /next sync/,
    );
    expect(connectionRows()).toHaveLength(1);
    expect(cloudflare.workers.has("shop-api")).toBe(true);
  });
});

describe("a target installed with pnpm", () => {
  // Cloudflare's build image defaults to a pnpm that refuses a settings-only
  // pnpm-workspace.yaml, which is what Cloudflare's own scaffolder writes.
  beforeEach(() => {
    holder.files["worker/pnpm-lock.yaml"] = "lockfileVersion: '9.0'";
  });

  it("tells Cloudflare to use the pnpm this machine uses", async () => {
    await handlers.handleConnectWorker({ appId, ...CONNECT });
    expect(
      cloudflare.buildVariables[cloudflare.triggers[0].trigger_uuid],
    ).toEqual({
      PNPM_VERSION: { value: "11.4.2", is_secret: false },
    });
  });

  it("prefers the version the project pins", async () => {
    holder.files["worker/package.json"] = JSON.stringify({
      packageManager: "pnpm@10.30.1+sha512.abcdef",
    });
    await handlers.handleConnectWorker({ appId, ...CONNECT });
    expect(
      cloudflare.buildVariables[cloudflare.triggers[0].trigger_uuid]
        .PNPM_VERSION,
    ).toEqual({ value: "10.30.1", is_secret: false });
  });

  it("leaves Cloudflare's default alone when no version is known", async () => {
    holder.localPnpmVersion = undefined;
    await handlers.handleConnectWorker({ appId, ...CONNECT });
    expect(cloudflare.buildVariables).toEqual({});
    expect(connectionRows()).toHaveLength(1);
  });

  it("removes the rule it created if the variable cannot be set", async () => {
    cloudflare.workers.set("shop-api", { tag: "tag-old", routeEnabled: false });
    cloudflare.failOn = (_, path) => path.endsWith("/environment_variables");

    await expect(
      handlers.handleConnectWorker({ appId, ...CONNECT, mode: "existing" }),
    ).rejects.toThrow(/simulated failure/);

    // The Worker was already there and stays; the rule was Dyad's and goes.
    expect(cloudflare.workers.has("shop-api")).toBe(true);
    expect(cloudflare.triggers).toHaveLength(0);
    expect(connectionRows()).toHaveLength(0);
  });
});

describe("a target not installed with pnpm", () => {
  it("sets no pnpm version", async () => {
    await handlers.handleConnectWorker({ appId, ...CONNECT });
    expect(cloudflare.buildVariables).toEqual({});
  });
});

describe("a Nitro app", () => {
  // Found the way the framework detection finds Nitro, from the manifest or
  // the Nitro config, on the committed branch.
  const CONNECT_ROOT = { ...CONNECT, rootDirectory: "", workerName: "shop" };

  beforeEach(() => {
    holder.committedFiles = ["package.json", "vite.config.ts"];
    holder.files = {
      "package.json": JSON.stringify({
        scripts: { build: "vite build" },
        dependencies: { nitro: "^3.0.0" },
      }),
    };
  });

  it("tells Nitro to build for Workers, and deploys what it generates", async () => {
    await handlers.handleConnectWorker({ appId, ...CONNECT_ROOT });

    const [trigger] = cloudflare.triggers;
    expect(trigger).toMatchObject({
      root_directory: "/",
      build_command: "npm run build",
      deploy_command: "npx wrangler deploy --name shop",
    });
    expect(cloudflare.buildVariables[trigger.trigger_uuid]).toEqual({
      NITRO_PRESET: { value: "cloudflare_module", is_secret: false },
    });
  });

  it("sets the preset beside the pnpm version", async () => {
    holder.files["pnpm-lock.yaml"] = "lockfileVersion: '9.0'";
    await handlers.handleConnectWorker({ appId, ...CONNECT_ROOT });
    expect(
      cloudflare.buildVariables[cloudflare.triggers[0].trigger_uuid],
    ).toEqual({
      NITRO_PRESET: { value: "cloudflare_module", is_secret: false },
      PNPM_VERSION: { value: "11.4.2", is_secret: false },
    });
  });

  it("keeps the preset when it has a Wrangler config of its own, which Nitro merges", async () => {
    holder.committedFiles.push("wrangler.jsonc");
    holder.files["wrangler.jsonc"] = `{ "name": "shop" }`;
    const status = await handlers.handleGetAppStatus(appId);
    expect(status.targets).toEqual([
      expect.objectContaining({ kind: "wrangler", nitro: true }),
    ]);

    await handlers.handleConnectWorker({ appId, ...CONNECT_ROOT });
    expect(
      cloudflare.buildVariables[cloudflare.triggers[0].trigger_uuid],
    ).toEqual({
      NITRO_PRESET: { value: "cloudflare_module", is_secret: false },
    });
  });

  it("is not a target once neither its config nor its dependency is committed", async () => {
    holder.files["package.json"] = JSON.stringify({ dependencies: {} });
    await expect(
      handlers.handleConnectWorker({ appId, ...CONNECT_ROOT }),
    ).rejects.toThrow(/No Wrangler config or Nitro app/);
    expect(cloudflare.calls).toEqual([]);
  });
});

describe("reading the target", () => {
  it("fails when GitHub does not accept Dyad's token", async () => {
    holder.settings.githubAccessToken = { value: "stale-token" };
    await expect(
      handlers.handleConnectWorker({ appId, ...CONNECT }),
    ).rejects.toMatchObject({
      message: "Could not read this app's repository from GitHub (401).",
      kind: "auth",
    });
    expect(cloudflare.workers.size).toBe(0);
  });

  it("keeps the repository's name out of a failure that gets reported", async () => {
    holder.githubStatus = 500;
    const error = await handlers
      .handleConnectWorker({ appId, ...CONNECT })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "external" });
    expect((error as Error).message).not.toMatch(/acme|shop/);
  });
});

describe("asking GitHub about the repository", () => {
  it("reports being offline as that, not as a crash", async () => {
    holder.githubOffline = true;
    await expect(
      handlers.handleCheckRepoAccess({ appId, accountId: ACCOUNT }),
    ).rejects.toMatchObject({
      name: "DyadError",
      message: expect.stringMatching(/Could not reach GitHub/),
    });
  });

  it("asks once, however often access is checked", async () => {
    // The tab polls this while the user is away granting access.
    for (let check = 0; check < 5; check++) {
      await handlers.handleCheckRepoAccess({ appId, accountId: ACCOUNT });
    }
    expect(holder.githubCalls).toBe(1);
  });
});

describe("refusing before anything is created", () => {
  async function expectNothingCreated(
    promise: Promise<unknown>,
    message: RegExp,
  ) {
    await expect(promise).rejects.toThrow(message);
    expect(cloudflare.workers.size).toBe(0);
    expect(cloudflare.triggers).toHaveLength(0);
    expect(connectionRows()).toHaveLength(0);
  }

  it("when Cloudflare cannot see the repository", async () => {
    cloudflare.visibleRepoIds.clear();
    await expectNothingCreated(
      handlers.handleConnectWorker({ appId, ...CONNECT }),
      /cannot see this GitHub repository/,
    );
  });

  it("when the account has no workers.dev subdomain", async () => {
    cloudflare.subdomain = null;
    await expectNothingCreated(
      handlers.handleConnectWorker({ appId, ...CONNECT }),
      /no workers.dev subdomain/,
    );
  });

  it("when the latest commit has not reached GitHub", async () => {
    // The tab checks this too, but the user can commit after it did.
    holder.refs["refs/heads/main"] = "sha-2";
    await expectNothingCreated(
      handlers.handleConnectWorker({ appId, ...CONNECT }),
      /Sync this app to GitHub first/,
    );
    expect(cloudflare.calls).toEqual([]);
  });

  it("when the folder is not a target on the synced branch", async () => {
    await expectNothingCreated(
      handlers.handleConnectWorker({
        appId,
        ...CONNECT,
        rootDirectory: "../../etc",
      }),
      /No Wrangler config/,
    );
    expect(cloudflare.calls).toEqual([]);
  });

  it("when the name could not be used safely in the deploy command", async () => {
    await expectNothingCreated(
      handlers.handleConnectWorker({
        appId,
        ...CONNECT,
        workerName: "x; rm -rf /",
      }),
      /lowercase letters/,
    );
    expect(cloudflare.calls).toEqual([]);
  });

  it("when a Worker with the new name already exists", async () => {
    cloudflare.workers.set("shop-api", { tag: "tag-old", routeEnabled: false });
    await expect(
      handlers.handleConnectWorker({ appId, ...CONNECT }),
    ).rejects.toThrow(/already exists/);
    // The Worker that was already there is not Dyad's to remove.
    expect(cloudflare.workers.has("shop-api")).toBe(true);
    expect(connectionRows()).toHaveLength(0);
  });

  it("when the folder is already connected", async () => {
    await handlers.handleConnectWorker({ appId, ...CONNECT });
    await expect(
      handlers.handleConnectWorker({
        appId,
        ...CONNECT,
        workerName: "another-name",
      }),
    ).rejects.toThrow(/already connected/);
    expect(cloudflare.workers.has("another-name")).toBe(false);
  });
});

describe("a failure after the Worker was created", () => {
  it("removes the Worker so nothing half-built is left", async () => {
    cloudflare.failOn = (method, path) =>
      method === "POST" && path.endsWith("/builds/triggers");

    await expect(
      handlers.handleConnectWorker({ appId, ...CONNECT }),
    ).rejects.toThrow(/simulated failure/);

    expect(cloudflare.workers.has("shop-api")).toBe(false);
    expect(connectionRows()).toHaveLength(0);
  });

  it("leaves an existing Worker alone", async () => {
    cloudflare.workers.set("shop-api", { tag: "tag-old", routeEnabled: false });
    cloudflare.failOn = (method, path) =>
      method === "POST" && path.endsWith("/builds/triggers");

    await expect(
      handlers.handleConnectWorker({ appId, ...CONNECT, mode: "existing" }),
    ).rejects.toThrow(/simulated failure/);

    expect(cloudflare.workers.has("shop-api")).toBe(true);
  });
});

describe("connecting to a Worker that already exists", () => {
  function existingWorkerDeployingFrom(repoConnectionUuid: string) {
    cloudflare.workers.set("shop-api", { tag: "tag-old", routeEnabled: false });
    cloudflare.triggers.push({
      trigger_uuid: "trigger-old",
      external_script_id: "tag-old",
      repo_connection_uuid: repoConnectionUuid,
      build_token_uuid: "build-token-old",
      branch_includes: ["main"],
      repo_connection: {
        repo_name: "other-site",
        provider_account_name: "someone",
      },
    });
  }

  it("asks before replacing a rule for another repository, changing nothing", async () => {
    existingWorkerDeployingFrom("conn-999");

    const result = await handlers.handleConnectWorker({
      appId,
      ...CONNECT,
      mode: "existing",
    });

    expect(result).toEqual({
      status: "conflict",
      existingRepo: "someone/other-site",
    });
    expect(cloudflare.triggers.map((t) => t.trigger_uuid)).toEqual([
      "trigger-old",
    ]);
    expect(cloudflare.workers.get("shop-api")?.routeEnabled).toBe(false);
    expect(connectionRows()).toHaveLength(0);
  });

  it("replaces that rule once the user agrees", async () => {
    existingWorkerDeployingFrom("conn-999");

    const result = await handlers.handleConnectWorker({
      appId,
      ...CONNECT,
      mode: "existing",
      overwrite: true,
    });

    expect(result.status).toBe("connected");
    expect(cloudflare.triggers).toHaveLength(1);
    expect(cloudflare.triggers[0]).toMatchObject({
      external_script_id: "tag-old",
      repo_connection_uuid: "conn-501",
    });
    expect(cloudflare.triggers[0].trigger_uuid).not.toBe("trigger-old");
  });

  it("updates a rule this repository already has instead of adding a second", async () => {
    existingWorkerDeployingFrom("conn-501");
    // Already this folder on this branch, so there is nothing to ask about.
    cloudflare.triggers[0].root_directory = "/worker";

    const result = await handlers.handleConnectWorker({
      appId,
      ...CONNECT,
      mode: "existing",
    });

    expect(result.status).toBe("connected");
    expect(cloudflare.triggers).toHaveLength(1);
    expect(cloudflare.triggers[0]).toMatchObject({
      trigger_uuid: "trigger-old",
      root_directory: "/worker",
      deploy_command: "npx wrangler deploy --name shop-api",
    });
    expect(connectionRows()[0].triggerUuid).toBe("trigger-old");
  });

  it("refuses a Worker another folder already deploys to, leaving its rule alone", async () => {
    await handlers.handleConnectWorker({ appId, ...CONNECT });
    const ruleBefore = { ...cloudflare.triggers[0] };
    holder.committedFiles.push("cron/wrangler.toml");

    await expect(
      handlers.handleConnectWorker({
        appId,
        ...CONNECT,
        rootDirectory: "cron",
        mode: "existing",
      }),
    ).rejects.toThrow(/already deploys folder "worker" of Shop/);

    // The first folder's rule must not be repointed at the second folder.
    expect(cloudflare.triggers).toEqual([ruleBefore]);
    expect(connectionRows().map((row) => row.rootDirectory)).toEqual([
      "worker",
    ]);
  });

  it("cannot store two folders on one Worker, whatever wrote the row", async () => {
    await handlers.handleConnectWorker({ appId, ...CONNECT });
    const [row] = connectionRows();

    // Straight to the table, the way a writer that skipped the handler's
    // check would: the schema is what holds the rule.
    expect(() =>
      db
        .insert(cloudflareAppConnections)
        .values({
          appId,
          rootDirectory: "cron",
          accountId: row.accountId,
          workerName: row.workerName,
          workerTag: row.workerTag,
          triggerUuid: "another-rule",
          workerUrl: row.workerUrl,
        })
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
    expect(connectionRows()).toHaveLength(1);
  });

  it("refuses a Worker that a different app deploys to", async () => {
    await handlers.handleConnectWorker({ appId, ...CONNECT });
    const otherAppId = db
      .insert(apps)
      .values({
        name: "Blog",
        path: "blog",
        githubOrg: "acme",
        githubRepo: "shop",
      })
      .returning({ id: apps.id })
      .get().id;

    await expect(
      handlers.handleConnectWorker({
        appId: otherAppId,
        ...CONNECT,
        mode: "existing",
      }),
    ).rejects.toThrow(/already deploys folder "worker" of Shop/);
    expect(cloudflare.triggers).toHaveLength(1);
  });

  it("puts a reused rule back as it was when the connection then fails", async () => {
    existingWorkerDeployingFrom("conn-501");
    Object.assign(cloudflare.triggers[0], {
      trigger_name: "Deploy production",
      build_command: "npm run compile",
      deploy_command: "npx wrangler deploy",
      root_directory: "/",
      path_includes: ["*"],
      path_excludes: [],
      branch_excludes: [],
    });
    const ruleBefore = structuredClone(cloudflare.triggers[0]);
    // A pnpm target needs one more call after the rule is rewritten.
    holder.files["worker/pnpm-lock.yaml"] = "lockfileVersion: '9.0'";
    cloudflare.failOn = (_, path) => path.endsWith("/environment_variables");

    await expect(
      handlers.handleConnectWorker({
        appId,
        ...CONNECT,
        mode: "existing",
        overwrite: true,
      }),
    ).rejects.toThrow(/simulated failure/);

    // Otherwise the rule would go on deploying this folder with no row in
    // Dyad to show for it.
    expect(cloudflare.triggers).toEqual([ruleBefore]);
    expect(connectionRows()).toHaveLength(0);
  });

  it("leaves how an existing Worker is reachable as it was, and shows no address for it", async () => {
    // Its owner may serve it only behind a custom domain.
    cloudflare.workers.set("shop-api", { tag: "tag-old", routeEnabled: false });

    await handlers.handleConnectWorker({ appId, ...CONNECT, mode: "existing" });

    expect(cloudflare.workers.get("shop-api")?.routeEnabled).toBe(false);
    expect(connectionRows()[0].workerUrl).toBeNull();
  });

  it("connects an existing Worker in an account with no workers.dev subdomain", async () => {
    // Served at its own domain only. Even with the Worker's route setting on,
    // there is no subdomain to make an address from.
    cloudflare.subdomain = null;
    cloudflare.workers.set("shop-api", { tag: "tag-old", routeEnabled: true });

    const result = await handlers.handleConnectWorker({
      appId,
      ...CONNECT,
      mode: "existing",
    });

    expect(result.status).toBe("connected");
    expect(connectionRows()[0].workerUrl).toBeNull();
  });

  it("keeps the workers.dev address of an existing Worker that is served there", async () => {
    cloudflare.workers.set("shop-api", { tag: "tag-old", routeEnabled: true });

    await handlers.handleConnectWorker({ appId, ...CONNECT, mode: "existing" });

    expect(connectionRows()[0].workerUrl).toBe(
      "https://shop-api.acme.workers.dev",
    );
  });

  it("asks before repointing this repository's rule from another branch", async () => {
    existingWorkerDeployingFrom("conn-501");
    Object.assign(cloudflare.triggers[0], {
      branch_includes: ["release"],
      root_directory: "/worker",
    });
    const ruleBefore = structuredClone(cloudflare.triggers[0]);

    const result = await handlers.handleConnectWorker({
      appId,
      ...CONNECT,
      mode: "existing",
    });

    expect(result).toEqual({
      status: "conflict",
      existingRepo: "someone/other-site (branch release, folder worker)",
    });
    expect(cloudflare.triggers).toEqual([ruleBefore]);
    expect(connectionRows()).toHaveLength(0);
  });

  it("asks before repointing this repository's rule from another folder", async () => {
    existingWorkerDeployingFrom("conn-501");
    cloudflare.triggers[0].root_directory = "/";

    const result = await handlers.handleConnectWorker({
      appId,
      ...CONNECT,
      mode: "existing",
    });

    expect(result).toEqual({
      status: "conflict",
      existingRepo: "someone/other-site (branch main, root folder)",
    });
    expect(connectionRows()).toHaveLength(0);
  });

  it("takes over this repository's rule on another branch once the user agrees", async () => {
    // Cloudflare would refuse a second rule on the Worker.
    existingWorkerDeployingFrom("conn-501");
    cloudflare.triggers[0].branch_includes = ["release"];

    const result = await handlers.handleConnectWorker({
      appId,
      ...CONNECT,
      mode: "existing",
      overwrite: true,
    });

    expect(result.status).toBe("connected");
    expect(cloudflare.triggers).toHaveLength(1);
    expect(cloudflare.triggers[0]).toMatchObject({
      trigger_uuid: "trigger-old",
      branch_includes: ["main"],
    });
  });

  it("leaves this repository's preview rule alone", async () => {
    existingWorkerDeployingFrom("conn-501");
    Object.assign(cloudflare.triggers[0], {
      branch_includes: ["*"],
      branch_excludes: ["main"],
      deploy_command: "npx wrangler versions upload",
    });
    const previewBefore = structuredClone(cloudflare.triggers[0]);

    await handlers.handleConnectWorker({ appId, ...CONNECT, mode: "existing" });

    expect(cloudflare.triggers).toHaveLength(2);
    expect(cloudflare.triggers[0]).toEqual(previewBefore);
    expect(connectionRows()[0].triggerUuid).toBe(
      cloudflare.triggers[1].trigger_uuid,
    );
  });

  it("says the replaced rule is gone when the connection then fails", async () => {
    existingWorkerDeployingFrom("conn-999");
    cloudflare.failOn = (method, path) =>
      method === "POST" && path.endsWith("/builds/triggers");

    await expect(
      handlers.handleConnectWorker({
        appId,
        ...CONNECT,
        mode: "existing",
        overwrite: true,
      }),
    ).rejects.toThrow(
      /simulated failure.*from the other repository was already removed/,
    );
  });

  it("does not name the replaced rule's repository in that error", async () => {
    // The error is reported, and the name may be a private repository's.
    existingWorkerDeployingFrom("conn-999");
    cloudflare.failOn = (method, path) =>
      method === "POST" && path.endsWith("/builds/triggers");

    const error = await handlers
      .handleConnectWorker({
        appId,
        ...CONNECT,
        mode: "existing",
        overwrite: true,
      })
      .catch((e: unknown) => e);
    expect((error as Error).message).not.toMatch(/someone|other-site/);
  });

  it("says who has the Worker when another connect wins the race for it", async () => {
    cloudflare.workers.set("shop-api", { tag: "tag-old", routeEnabled: false });
    const otherAppId = db
      .insert(apps)
      .values({ name: "Blog", path: "blog" })
      .returning({ id: apps.id })
      .get().id;
    // The other connect lands after this one checked the Worker was free.
    cloudflare.failOn = (method, path) => {
      if (method === "POST" && path.endsWith("/builds/triggers")) {
        db.insert(cloudflareAppConnections)
          .values({
            appId: otherAppId,
            rootDirectory: "",
            accountId: ACCOUNT,
            workerName: "shop-api",
            workerTag: "tag-old",
            triggerUuid: "their-rule",
            workerUrl: null,
          })
          .run();
      }
      return false;
    };

    const error = await handlers
      .handleConnectWorker({ appId, ...CONNECT, mode: "existing" })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ kind: "conflict" });
    expect((error as Error).message).toMatch(
      /already deploys the app root of Blog/,
    );
    expect((error as Error).message).not.toMatch(/UNIQUE/);
    // This connect's rule is rolled back; the winner's row is untouched.
    expect(cloudflare.triggers).toHaveLength(0);
    expect(
      db
        .select()
        .from(cloudflareAppConnections)
        .all()
        .map((row) => row.appId),
    ).toEqual([otherAppId]);
  });

  it("says nothing about a removed rule when none was removed", async () => {
    cloudflare.workers.set("shop-api", { tag: "tag-old", routeEnabled: false });
    cloudflare.failOn = (method, path) =>
      method === "POST" && path.endsWith("/builds/triggers");

    await expect(
      handlers.handleConnectWorker({ appId, ...CONNECT, mode: "existing" }),
    ).rejects.toThrow(/simulated failure$/);
  });

  it("fails clearly when the chosen Worker is not in the account", async () => {
    await expect(
      handlers.handleConnectWorker({ appId, ...CONNECT, mode: "existing" }),
    ).rejects.toThrow(/No Worker named/);
  });
});

describe("listing an account's Workers", () => {
  it("says the account is the problem when the token cannot use it", async () => {
    // A token can be good for one account and not another.
    cloudflare.failOn = (_, path) => path.endsWith("/workers/scripts");
    cloudflare.failStatus = 403;
    await expect(handlers.handleListWorkers(ACCOUNT)).rejects.toMatchObject({
      kind: "auth",
      message: expect.stringMatching(
        /cannot use Workers in this Cloudflare account/,
      ),
    });
  });

  it("reports any other failure as it is", async () => {
    cloudflare.failOn = (_, path) => path.endsWith("/workers/scripts");
    await expect(handlers.handleListWorkers(ACCOUNT)).rejects.toThrow(
      /Could not list Workers: simulated failure/,
    );
  });
});

describe("disconnecting", () => {
  it("says how to get out when Cloudflare refuses the token", async () => {
    await handlers.handleConnectWorker({ appId, ...CONNECT });
    cloudflare.failOn = (method) => method === "DELETE";
    cloudflare.failStatus = 401;

    await expect(
      handlers.handleDisconnect({ appId, rootDirectory: "worker" }),
    ).rejects.toMatchObject({
      kind: "auth",
      message: expect.stringMatching(/Remove the token under Settings/),
    });
    // The rule is still there, so the connection must be too.
    expect(connectionRows()).toHaveLength(1);
  });

  it("removes the deploy rule and the row but keeps the Worker", async () => {
    await handlers.handleConnectWorker({ appId, ...CONNECT });

    await handlers.handleDisconnect({ appId, rootDirectory: "worker" });

    expect(cloudflare.triggers).toHaveLength(0);
    expect(connectionRows()).toHaveLength(0);
    expect(cloudflare.workers.has("shop-api")).toBe(true);
  });

  it("succeeds when the rule was already deleted on Cloudflare", async () => {
    await handlers.handleConnectWorker({ appId, ...CONNECT });
    cloudflare.triggers.length = 0;

    await handlers.handleDisconnect({ appId, rootDirectory: "worker" });

    expect(connectionRows()).toHaveLength(0);
  });

  it("keeps the row when Cloudflare could not remove the rule", async () => {
    await handlers.handleConnectWorker({ appId, ...CONNECT });
    cloudflare.failOn = (method) => method === "DELETE";

    await expect(
      handlers.handleDisconnect({ appId, rootDirectory: "worker" }),
    ).rejects.toThrow(/deploy rule/);

    // Otherwise Dyad would say "disconnected" while pushes keep deploying.
    expect(connectionRows()).toHaveLength(1);
  });

  it("goes with the app when the app is deleted", async () => {
    await handlers.handleConnectWorker({ appId, ...CONNECT });
    db.delete(apps).where(eq(apps.id, appId)).run();
    expect(db.select().from(cloudflareAppConnections).all()).toEqual([]);
  });
});

describe("an app with a Neon database", () => {
  beforeEach(() => {
    db.update(apps).set({ neonProjectId: "neon-proj" }).run();
  });

  it("puts the database secrets on the Worker and trusts its address when connecting", async () => {
    const result = await handlers.handleConnectWorker({ appId, ...CONNECT });

    expect(result).toMatchObject({ status: "connected", warning: undefined });
    expect(cloudflare.secrets["shop-api"]).toEqual({
      DATABASE_URL: "postgres://db.neon.test/app",
      NEON_AUTH_BASE_URL: "https://auth.neon.test/app/auth",
    });
    expect(neon.trustedOrigins).toEqual(["https://shop-api.acme.workers.dev"]);
    // The secrets go on the Worker, where the deployed code reads them, not
    // on the rule, whose variables exist only during the build.
    expect(cloudflare.buildVariables).toEqual({});
    // Set before the first build so the first deployment has them.
    const secretsCall = cloudflare.calls.findIndex((call) =>
      call.endsWith("/secrets"),
    );
    const buildCall = cloudflare.calls.findIndex((call) =>
      call.endsWith("/builds"),
    );
    expect(secretsCall).toBeGreaterThan(-1);
    expect(secretsCall).toBeLessThan(buildCall);
  });

  it("follows the branch the app deploys from", async () => {
    db.update(apps).set({ selectedDatabaseBranchType: "development" }).run();
    await handlers.handleConnectWorker({ appId, ...CONNECT });
    expect(neon.branchTypes).toEqual(["development"]);
  });

  it("sets only the database URL, and says so, when Neon Auth is off", async () => {
    neon.resolved.neonAuthBaseUrl = undefined;
    const result = await handlers.handleConnectWorker({ appId, ...CONNECT });

    expect(cloudflare.secrets["shop-api"]).toEqual({
      DATABASE_URL: "postgres://db.neon.test/app",
    });
    expect(neon.trustedOrigins).toEqual([]);
    expect(result.status === "connected" && result.warning).toMatch(
      /Neon Auth is not active/,
    );
  });

  it("still connects, and says how to retry, when the secrets cannot be set", async () => {
    cloudflare.failOn = (method, path) =>
      method === "PUT" && path.endsWith("/secrets");
    const result = await handlers.handleConnectWorker({ appId, ...CONNECT });

    expect(result.status).toBe("connected");
    expect(result.status === "connected" && result.warning).toMatch(
      /Sync to Cloudflare/,
    );
    expect(connectionRows()).toHaveLength(1);
    expect(cloudflare.startedBuilds).toHaveLength(1);
  });

  it("still connects when Neon cannot be reached", async () => {
    neon.resolveError = new Error("Neon is down");
    const result = await handlers.handleConnectWorker({ appId, ...CONNECT });

    expect(result.status).toBe("connected");
    expect(result.status === "connected" && result.warning).toMatch(
      /Neon is down/,
    );
    expect(cloudflare.secrets).toEqual({});
  });

  it("skips the allowlist for a Worker without a workers.dev address", async () => {
    cloudflare.workers.set("shop-api", { tag: "tag-old", routeEnabled: false });
    const result = await handlers.handleConnectWorker({
      appId,
      ...CONNECT,
      mode: "existing",
    });

    expect(cloudflare.secrets["shop-api"]).toBeDefined();
    expect(neon.trustedOrigins).toEqual([]);
    expect(result.status === "connected" && result.warning).toMatch(
      /no workers.dev address/,
    );
  });

  it("touches neither Neon nor the Worker's secrets for an app without Neon", async () => {
    db.update(apps).set({ neonProjectId: null }).run();
    await handlers.handleConnectWorker({ appId, ...CONNECT });

    expect(neon.branchTypes).toEqual([]);
    expect(cloudflare.secrets).toEqual({});
  });

  describe("syncing on request", () => {
    it("updates every connected Worker and reports a clean sync", async () => {
      await handlers.handleConnectWorker({ appId, ...CONNECT });
      holder.committedFiles.push("cron/wrangler.toml");
      await handlers.handleConnectWorker({
        appId,
        ...CONNECT,
        rootDirectory: "cron",
        workerName: "shop-cron",
      });
      neon.resolved.databaseUrl = "postgres://db.neon.test/app-dev";

      const result = await syncNeonConfigToCloudflare({
        appId,
        branchType: "development",
      });

      expect(result).toEqual({
        envPushed: true,
        domainsAdded: [],
        skipped: [],
        warning: undefined,
      });
      expect(neon.branchTypes.at(-1)).toBe("development");
      for (const name of ["shop-api", "shop-cron"]) {
        expect(cloudflare.secrets[name].DATABASE_URL).toBe(
          "postgres://db.neon.test/app-dev",
        );
      }
    });

    it("reports a Worker that refused the secrets without skipping the others", async () => {
      await handlers.handleConnectWorker({ appId, ...CONNECT });
      holder.committedFiles.push("cron/wrangler.toml");
      await handlers.handleConnectWorker({
        appId,
        ...CONNECT,
        rootDirectory: "cron",
        workerName: "shop-cron",
      });
      cloudflare.failOn = (method, path) =>
        method === "PUT" && path.includes("/scripts/shop-api/secrets");
      neon.resolved.databaseUrl = "postgres://db.neon.test/app-2";

      const result = await syncNeonConfigToCloudflare({ appId });

      expect(result.envPushed).toBe(false);
      expect(result.warning).toMatch(/shop-api/);
      expect(cloudflare.secrets["shop-cron"].DATABASE_URL).toBe(
        "postgres://db.neon.test/app-2",
      );
    });

    it("reports a failed allowlist update as a warning, with the secrets set", async () => {
      await handlers.handleConnectWorker({ appId, ...CONNECT });
      neon.trustError = new Error("Neon refused the domain");

      const result = await syncNeonConfigToCloudflare({ appId });

      expect(result.envPushed).toBe(true);
      expect(result.warning).toMatch(/Neon refused the domain/);
    });

    it("refuses an app with no Worker", async () => {
      await expect(syncNeonConfigToCloudflare({ appId })).rejects.toMatchObject(
        {
          kind: "precondition",
          message: expect.stringMatching(
            /not connected to a Cloudflare Worker/,
          ),
        },
      );
    });

    it("refuses an app with no Neon project", async () => {
      await handlers.handleConnectWorker({ appId, ...CONNECT });
      db.update(apps).set({ neonProjectId: null }).run();
      await expect(syncNeonConfigToCloudflare({ appId })).rejects.toMatchObject(
        {
          kind: "precondition",
          message: expect.stringMatching(/not connected to a Neon project/),
        },
      );
    });
  });

  describe("removing the secrets", () => {
    it("takes them off every Worker, leaving other secrets alone", async () => {
      await handlers.handleConnectWorker({ appId, ...CONNECT });
      holder.committedFiles.push("cron/wrangler.toml");
      await handlers.handleConnectWorker({
        appId,
        ...CONNECT,
        rootDirectory: "cron",
        workerName: "shop-cron",
      });
      cloudflare.secrets["shop-api"].API_KEY = "keep";

      const result = await removeNeonEnvVarsFromCloudflare({ appId });

      expect(result).toEqual({
        removedKeys: ["DATABASE_URL", "NEON_AUTH_BASE_URL"],
        warning: undefined,
      });
      expect(cloudflare.secrets["shop-api"]).toEqual({ API_KEY: "keep" });
      expect(cloudflare.secrets["shop-cron"]).toEqual({});
    });

    it("counts a secret that was already gone as removed", async () => {
      await handlers.handleConnectWorker({ appId, ...CONNECT });
      delete cloudflare.secrets["shop-api"].NEON_AUTH_BASE_URL;

      const result = await removeNeonEnvVarsFromCloudflare({ appId });

      expect(result.removedKeys).toEqual([
        "DATABASE_URL",
        "NEON_AUTH_BASE_URL",
      ]);
      expect(result.warning).toBeUndefined();
    });

    it("names the secret it could not remove", async () => {
      await handlers.handleConnectWorker({ appId, ...CONNECT });
      cloudflare.failOn = (method, path) =>
        method === "DELETE" && path.endsWith("/secrets/DATABASE_URL");

      const result = await removeNeonEnvVarsFromCloudflare({ appId });

      expect(result.removedKeys).toEqual(["NEON_AUTH_BASE_URL"]);
      expect(result.warning).toMatch(/DATABASE_URL from shop-api/);
      expect(cloudflare.secrets["shop-api"]).toEqual({
        DATABASE_URL: "postgres://db.neon.test/app",
      });
    });

    it("does nothing for an app with no Worker", async () => {
      holder.settings = {};
      await expect(removeNeonEnvVarsFromCloudflare({ appId })).resolves.toEqual(
        { removedKeys: [] },
      );
    });
  });
});

describe("the app's status", () => {
  it("says the branch could not be read, rather than that there is no Worker", async () => {
    // A repository imported with another default branch has no local "main".
    delete holder.refs["refs/heads/main"];
    await expect(handlers.handleGetAppStatus(appId)).rejects.toMatchObject({
      kind: "precondition",
      message: 'Could not read the "main" branch of this app\'s repository.',
    });
  });

  it("still lists a connected folder when the branch cannot be read", async () => {
    // Disconnecting does not need the branch, so the folder must stay reachable.
    await handlers.handleConnectWorker({ appId, ...CONNECT });
    delete holder.refs["refs/heads/main"];

    const status = await handlers.handleGetAppStatus(appId);

    expect(status.targets).toEqual([]);
    expect(status.connections.map((c) => c.rootDirectory)).toEqual(["worker"]);
  });

  it("lists targets with the Worker name their config declares", async () => {
    const status = await handlers.handleGetAppStatus(appId);
    expect(status).toMatchObject({
      synced: true,
      branch: "main",
      targets: [
        {
          kind: "wrangler",
          rootDirectory: "worker",
          configPath: "worker/wrangler.jsonc",
          nitro: false,
          label: "worker",
          suggestedWorkerName: "shop-api",
        },
      ],
      connections: [],
    });
  });

  it("finds a Nitro app in a folder whose name holds a newline", async () => {
    holder.committedFiles = [
      "odd\nname/package.json",
      "odd\nname/vite.config.ts",
    ];
    holder.files["odd\nname/package.json"] = JSON.stringify({
      dependencies: { nitro: "^3.0.0" },
    });
    const status = await handlers.handleGetAppStatus(appId);
    expect(status.targets).toEqual([
      expect.objectContaining({ kind: "nitro", rootDirectory: "odd\nname" }),
    ]);
  });

  it("lists a Nitro app as a target named after the app", async () => {
    holder.committedFiles = ["package.json", "nitro.config.ts"];
    const status = await handlers.handleGetAppStatus(appId);
    expect(status.targets).toEqual([
      {
        kind: "nitro",
        rootDirectory: "",
        label: "App root",
        suggestedWorkerName: "shop",
      },
    ]);
  });

  it("is not synced while the latest commit has not reached GitHub", async () => {
    holder.refs["refs/heads/main"] = "sha-2";
    expect((await handlers.handleGetAppStatus(appId)).synced).toBe(false);
  });

  it("is not synced when the branch was never pushed", async () => {
    delete holder.refs["refs/remotes/origin/main"];
    expect((await handlers.handleGetAppStatus(appId)).synced).toBe(false);
  });

  it("reports whether Cloudflare can see the repository", async () => {
    expect(
      await handlers.handleCheckRepoAccess({ appId, accountId: ACCOUNT }),
    ).toEqual({ hasAccess: true });
    cloudflare.visibleRepoIds.clear();
    expect(
      await handlers.handleCheckRepoAccess({ appId, accountId: ACCOUNT }),
    ).toEqual({ hasAccess: false });
  });
});

describe("deployment status", () => {
  beforeEach(async () => {
    await handlers.handleConnectWorker({ appId, ...CONNECT });
  });

  it("is empty before the first build", async () => {
    expect(
      await handlers.handleGetDeploymentStatus({
        appId,
        rootDirectory: "worker",
      }),
    ).toMatchObject({ state: "none", logTail: [] });
  });

  it("reports the newest build, whatever order Cloudflare lists them in", async () => {
    cloudflare.builds = [
      {
        build_uuid: "b-1",
        status: "stopped",
        build_outcome: "fail",
        created_on: "2026-01-01T00:00:00Z",
      },
      {
        build_uuid: "b-2",
        status: "running",
        created_on: "2026-01-02T00:00:00Z",
        build_trigger_metadata: { commit_hash: "abc1234def" },
      },
    ];
    expect(
      await handlers.handleGetDeploymentStatus({
        appId,
        rootDirectory: "worker",
      }),
    ).toMatchObject({ state: "building", commitHash: "abc1234def" });
  });

  it("reports what this folder's rule last deployed, not the Worker's other builds", async () => {
    const own = { trigger_uuid: cloudflare.triggers[0].trigger_uuid };
    cloudflare.builds = [
      {
        build_uuid: "b-1",
        status: "stopped",
        build_outcome: "success",
        created_on: "2026-01-01T00:00:00Z",
        build_trigger_metadata: { commit_hash: "abc1234def" },
        trigger: own,
      },
      // A preview rule on the same Worker, building some other branch.
      {
        build_uuid: "b-2",
        status: "stopped",
        build_outcome: "fail",
        created_on: "2026-01-02T00:00:00Z",
        trigger: { trigger_uuid: "preview-rule" },
      },
      // A push Cloudflare looked at and deployed nothing for.
      {
        build_uuid: "b-3",
        status: "stopped",
        build_outcome: "skipped",
        created_on: "2026-01-03T00:00:00Z",
        trigger: own,
      },
    ];
    expect(
      await handlers.handleGetDeploymentStatus({
        appId,
        rootDirectory: "worker",
      }),
    ).toMatchObject({ state: "live", commitHash: "abc1234def" });
  });

  it("explains a failure with the end of its log", async () => {
    cloudflare.builds = [
      { build_uuid: "b-1", status: "stopped", build_outcome: "fail" },
    ];
    cloudflare.logs["b-1"] = Array.from({ length: 40 }, (_, line) => [
      line,
      `line ${line}`,
    ]);
    const status = await handlers.handleGetDeploymentStatus({
      appId,
      rootDirectory: "worker",
    });
    expect(status.state).toBe("failed");
    expect(status.logTail).toHaveLength(30);
    expect(status.logTail.at(-1)).toBe("line 39");
    expect(status.tokenRevoked).toBe(false);
  });

  it("says so when the failure is a deleted or rolled token", async () => {
    cloudflare.builds = [
      { build_uuid: "b-1", status: "stopped", build_outcome: "fail" },
    ];
    cloudflare.logs["b-1"] = [
      [
        1,
        "Failed: The build token selected for this build has been deleted or rolled and cannot be used for this build.",
      ],
    ];
    expect(
      (
        await handlers.handleGetDeploymentStatus({
          appId,
          rootDirectory: "worker",
        })
      ).tokenRevoked,
    ).toBe(true);
  });

  it("notices when the deploy rule was deleted on Cloudflare", async () => {
    const target = { appId, rootDirectory: "worker" };
    expect((await handlers.handleGetDeploymentStatus(target)).ruleMissing).toBe(
      false,
    );

    // Deleted in the dashboard, or by another connection that shared it. The
    // Worker and its last successful build are still there.
    cloudflare.builds = [
      { build_uuid: "b-1", status: "stopped", build_outcome: "success" },
    ];
    // The Worker still has a rule, just not the one this folder was given.
    cloudflare.triggers[0].trigger_uuid = "someone-elses-rule";

    expect(await handlers.handleGetDeploymentStatus(target)).toMatchObject({
      state: "live",
      ruleMissing: true,
    });
  });

  it("says nothing about where the rule points while it matches the app", async () => {
    expect(
      (
        await handlers.handleGetDeploymentStatus({
          appId,
          rootDirectory: "worker",
        })
      ).ruleDeploys,
    ).toBeNull();
  });

  it("says what the rule deploys once the app syncs another branch", async () => {
    db.update(apps)
      .set({ githubBranch: "redesign" })
      .where(eq(apps.id, appId))
      .run();
    expect(
      (
        await handlers.handleGetDeploymentStatus({
          appId,
          rootDirectory: "worker",
        })
      ).ruleDeploys,
    ).toBe("acme/shop (branch main, folder worker)");
  });

  it("does not warn about a rule widened to every branch", async () => {
    cloudflare.triggers[0].branch_includes = ["*"];
    db.update(apps)
      .set({ githubBranch: "redesign" })
      .where(eq(apps.id, appId))
      .run();
    const target = { appId, rootDirectory: "worker" };
    expect(
      (await handlers.handleGetDeploymentStatus(target)).ruleDeploys,
    ).toBeNull();

    cloudflare.triggers[0].branch_excludes = ["redesign"];
    expect(
      (await handlers.handleGetDeploymentStatus(target)).ruleDeploys,
    ).not.toBeNull();
  });

  it("gives the Worker's address as its route is now", async () => {
    const target = { appId, rootDirectory: "worker" };
    expect((await handlers.handleGetDeploymentStatus(target)).workerUrl).toBe(
      "https://shop-api.acme.workers.dev",
    );

    // Switched off in the dashboard, or by a deploy whose config says so.
    cloudflare.workers.get("shop-api")!.routeEnabled = false;
    expect(
      (await handlers.handleGetDeploymentStatus(target)).workerUrl,
    ).toBeNull();
  });

  it("finds the address of a Worker whose route was turned on after connecting", async () => {
    db.update(cloudflareAppConnections)
      .set({ workerUrl: null })
      .where(eq(cloudflareAppConnections.appId, appId))
      .run();
    expect(
      (
        await handlers.handleGetDeploymentStatus({
          appId,
          rootDirectory: "worker",
        })
      ).workerUrl,
    ).toBe("https://shop-api.acme.workers.dev");
  });

  it("keeps the stored address when the route cannot be read", async () => {
    // Off, so an answer that did get through would clear the address and
    // fail this test.
    cloudflare.workers.get("shop-api")!.routeEnabled = false;
    cloudflare.failOn = (_, path) => path.endsWith("/subdomain");
    expect(
      (
        await handlers.handleGetDeploymentStatus({
          appId,
          rootDirectory: "worker",
        })
      ).workerUrl,
    ).toBe("https://shop-api.acme.workers.dev");
  });

  it("says what the rule deploys once the app syncs another repository", async () => {
    db.update(apps)
      .set({ githubRepo: "shop-v2" })
      .where(eq(apps.id, appId))
      .run();
    expect(
      (
        await handlers.handleGetDeploymentStatus({
          appId,
          rootDirectory: "worker",
        })
      ).ruleDeploys,
    ).toBe("acme/shop (branch main, folder worker)");
  });

  it("does not guess where the rule points when rules could not be listed", async () => {
    db.update(apps)
      .set({ githubBranch: "redesign" })
      .where(eq(apps.id, appId))
      .run();
    cloudflare.failOn = (_, path) => path.endsWith("/triggers");
    expect(
      (
        await handlers.handleGetDeploymentStatus({
          appId,
          rootDirectory: "worker",
        })
      ).ruleDeploys,
    ).toBeNull();
  });

  it("does not call a rule missing just because rules could not be listed", async () => {
    cloudflare.failOn = (_, path) => path.endsWith("/triggers");
    expect(
      (
        await handlers.handleGetDeploymentStatus({
          appId,
          rootDirectory: "worker",
        })
      ).ruleMissing,
    ).toBe(false);
  });

  it("still reports a failure when its log cannot be read", async () => {
    cloudflare.builds = [
      { build_uuid: "b-1", status: "stopped", build_outcome: "fail" },
    ];
    cloudflare.failOn = (_, path) => path.endsWith("/logs");
    expect(
      await handlers.handleGetDeploymentStatus({
        appId,
        rootDirectory: "worker",
      }),
    ).toMatchObject({ state: "failed", logTail: [] });
  });
});

describe("saving an API token", () => {
  beforeEach(() => {
    delete holder.settings.cloudflareAccessToken;
  });

  it("saves a token that can do both jobs", async () => {
    await handlers.handleSaveToken("  new-token  ");
    expect(holder.settings.cloudflareAccessToken).toEqual({
      value: "new-token",
    });
  });

  it("rejects a token that is not active", async () => {
    cloudflare.tokenStatus = "expired";
    await expect(handlers.handleSaveToken("new-token")).rejects.toThrow(
      /expired/,
    );
    expect(holder.settings.cloudflareAccessToken).toBeUndefined();
  });

  it("rejects a token that cannot use the builds API", async () => {
    cloudflare.canUseBuilds = false;
    await expect(handlers.handleSaveToken("new-token")).rejects.toThrow(
      /missing a permission/,
    );
    expect(holder.settings.cloudflareAccessToken).toBeUndefined();
  });

  it("does not call the token bad when Cloudflare is the one failing", async () => {
    cloudflare.failOn = (_, path) => path === "/user/tokens/verify";
    await expect(handlers.handleSaveToken("new-token")).rejects.toThrow(
      /Could not check the API token: simulated failure/,
    );
    expect(holder.settings.cloudflareAccessToken).toBeUndefined();
  });

  it("does not blame permissions for a failure that is not about them", async () => {
    cloudflare.failOn = (_, path) => path.endsWith("/workers/scripts");
    await expect(handlers.handleSaveToken("new-token")).rejects.toThrow(
      /Could not check the API token's permissions: simulated failure/,
    );
    expect(holder.settings.cloudflareAccessToken).toBeUndefined();
  });

  it("moves every rule it can when one cannot be moved", async () => {
    holder.settings.cloudflareAccessToken = { value: TOKEN };
    await handlers.handleConnectWorker({ appId, ...CONNECT });
    holder.committedFiles.push("cron/wrangler.toml");
    await handlers.handleConnectWorker({
      appId,
      ...CONNECT,
      rootDirectory: "cron",
      workerName: "shop-cron",
    });
    const [first, second] = cloudflare.triggers;
    cloudflare.buildTokens.length = 0;
    // The first rule was deleted on Cloudflare; the second is fine.
    cloudflare.triggers.splice(cloudflare.triggers.indexOf(first), 1);

    await handlers.handleSaveToken("replacement-token");

    expect(second.build_token_uuid).toBe(
      cloudflare.buildTokens[0].build_token_uuid,
    );
    expect(holder.settings.cloudflareAccessToken).toEqual({
      value: "replacement-token",
    });
  });

  it("points existing deploy rules at the replacement token", async () => {
    holder.settings.cloudflareAccessToken = { value: TOKEN };
    await handlers.handleConnectWorker({ appId, ...CONNECT });
    // The old token was rolled: Cloudflare no longer has its registration.
    cloudflare.buildTokens.length = 0;

    await handlers.handleSaveToken("replacement-token");

    expect(cloudflare.buildTokens).toHaveLength(1);
    expect(cloudflare.triggers[0].build_token_uuid).toBe(
      cloudflare.buildTokens[0].build_token_uuid,
    );
  });
});
