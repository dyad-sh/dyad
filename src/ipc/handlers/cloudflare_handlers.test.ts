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
  execGit: async (args: string[]) => {
    if (args[0] === "ls-tree") {
      return {
        exitCode: 0,
        stdout: holder.committedFiles.join("\0"),
        stderr: "",
      };
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

const { cloudflareHandlersForTesting: handlers } =
  await import("./cloudflare_handlers");

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
  buildTokens: { build_token_uuid: string; cloudflare_token_id: string }[];
  triggers: FakeTrigger[];
  builds: Record<string, unknown>[];
  logs: Record<string, [number, string][]>;
  startedBuilds: string[];
  buildVariables: Record<string, Record<string, unknown>>;
  failOn: ((method: string, path: string) => boolean) | null;
  calls: string[];
}

let cloudflare: FakeCloudflare;
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
    return fail(500, 1, "simulated failure");
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
    cloudflare.workers.get(match[1])!.routeEnabled = true;
    return ok({ enabled: true });
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
    const trigger = { ...body, trigger_uuid: id("trigger") } as FakeTrigger;
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
  handlers.clearGithubIdentityCache();
  holder.files = {
    "worker/wrangler.jsonc": `{ "name": "shop-api" }`,
  };
  cloudflare = {
    tokenStatus: "active",
    canUseBuilds: true,
    subdomain: "acme",
    visibleRepoIds: new Set(["501"]),
    workers: new Map(),
    buildTokens: [],
    triggers: [],
    builds: [],
    logs: {},
    startedBuilds: [],
    buildVariables: {},
    failOn: null,
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

describe("reading the target", () => {
  it("fails when GitHub does not accept Dyad's token", async () => {
    holder.settings.githubAccessToken = { value: "stale-token" };
    await expect(
      handlers.handleConnectWorker({ appId, ...CONNECT }),
    ).rejects.toThrow(/Could not read acme\/shop from GitHub \(401\)/);
    expect(cloudflare.workers.size).toBe(0);
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
    ).rejects.toThrow(/already deploys worker of Shop/);

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
    ).rejects.toThrow(/already deploys worker of Shop/);
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
      handlers.handleConnectWorker({ appId, ...CONNECT, mode: "existing" }),
    ).rejects.toThrow(/simulated failure/);

    // Otherwise the rule would go on deploying this folder with no row in
    // Dyad to show for it.
    expect(cloudflare.triggers).toEqual([ruleBefore]);
    expect(connectionRows()).toHaveLength(0);
  });

  it("leaves how an existing Worker is reachable as it was", async () => {
    // Its owner may serve it only behind a custom domain.
    cloudflare.workers.set("shop-api", { tag: "tag-old", routeEnabled: false });

    await handlers.handleConnectWorker({ appId, ...CONNECT, mode: "existing" });

    expect(cloudflare.workers.get("shop-api")?.routeEnabled).toBe(false);
    expect(connectionRows()).toHaveLength(1);
  });

  it("takes over this repository's rule even when it named another branch", async () => {
    // Cloudflare would refuse a second rule on the Worker.
    existingWorkerDeployingFrom("conn-501");
    cloudflare.triggers[0].branch_includes = ["release"];

    const result = await handlers.handleConnectWorker({
      appId,
      ...CONNECT,
      mode: "existing",
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

  it("fails clearly when the chosen Worker is not in the account", async () => {
    await expect(
      handlers.handleConnectWorker({ appId, ...CONNECT, mode: "existing" }),
    ).rejects.toThrow(/No Worker named/);
  });
});

describe("disconnecting", () => {
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

describe("the app's status", () => {
  it("lists targets with the Worker name their config declares", async () => {
    const status = await handlers.handleGetAppStatus(appId);
    expect(status).toMatchObject({
      synced: true,
      branch: "main",
      targets: [
        {
          rootDirectory: "worker",
          configPath: "worker/wrangler.jsonc",
          label: "worker",
          suggestedWorkerName: "shop-api",
        },
      ],
      connections: [],
    });
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
