import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// The pipeline reads settings through this module directly, so the harness's
// in-memory settings would not reach it. writeSettings and DEFAULT_SETTINGS are
// here because the handler harness and its context module import them too.
vi.mock("@/main/settings", () => ({
  readSettings: () => ({
    coolify: {
      instanceUrl: "https://coolify.test",
      accessToken: { value: "token" },
    },
    githubAccessToken: { value: "gh-token" },
  }),
  writeSettings: vi.fn(),
  DEFAULT_SETTINGS: {},
}));

vi.mock("@/ipc/handlers/github_handlers", () => ({
  getGitHubApiBase: () => "https://github.test/api",
}));

// Real git would shell out to dugite against a directory that does not exist.
const git = vi.hoisted(() => ({
  uncommitted: [] as string[],
  hashes: { HEAD: "abc", remote: "abc" } as Record<string, string>,
}));
vi.mock("@/ipc/utils/git_utils", () => ({
  getCurrentCommitHash: async ({ ref }: { ref: string }) => {
    const value = ref === "HEAD" ? git.hashes.HEAD : git.hashes.remote;
    if (value === "__throw__") throw new Error("unknown revision");
    return value;
  },
  getGitUncommittedFiles: async () => git.uncommitted,
}));

// Real key handling writes a keypair to disk, which a test must not do.
vi.mock("@/ipc/utils/coolify_deploy_key", () => ({
  repoKeyName: (owner: string, repo: string) => `dyad_${owner}_${repo}`,
  // Identity here: the fingerprint suffix is this module's own concern, and
  // routing it through would only make every route name in these tests noisier.
  coolifyKeyName: (keyName: string) => keyName,
  // Returns a public key, as the real one does — production sends this
  // value to GitHub, so a mock handing back the key name would be lying
  // about the shape of what it returns.
  ensureDeployKey: vi.fn(async () => "ssh-ed25519 AAAAPUBLIC comment"),
  readPrivateKey: () => "PRIVATE",
  deployKeyFilePath: (name: string) => `/keys/${name}`,
}));

const framework = vi.hoisted(() => ({
  type: "vite" as string | null,
  declaresStart: false,
}));
vi.mock("@/ipc/utils/framework_utils", () => ({
  detectFrameworkType: () => framework.type,
  declaresStart: () => framework.declaresStart,
}));

// The real resolver talks to Neon; the pipeline's job is to pass the branch the
// user picked and set every var it gets back.
const neon = vi.hoisted(() => ({
  resolved: {
    databaseUrl: "postgres://prod",
    neonAuthBaseUrl: "https://auth.neon.test/db/auth",
    neonAuthCookieSecret: "cookie-secret",
    branchId: "br-prod",
    isNextJs: false,
  } as Record<string, unknown>,
  branchTypes: [] as string[],
  trustedDomains: [] as Array<{
    projectId: string;
    branchId: string;
    origin: string;
  }>,
  trustedDomainError: null as Error | null,
}));
vi.mock("@/ipc/utils/neon_utils", () => ({
  getSelectedDeployBranchType: (app: {
    selectedDatabaseBranchType?: unknown;
  }) =>
    app.selectedDatabaseBranchType === "development"
      ? "development"
      : "production",
  resolveNeonBranchEnvVars: vi.fn(
    async ({ branchType }: { branchType: string }) => {
      neon.branchTypes.push(branchType);
      return neon.resolved;
    },
  ),
  ensureNeonAuthTrustedDomain: vi.fn(
    async (args: { projectId: string; branchId: string; origin: string }) => {
      if (neon.trustedDomainError) throw neon.trustedDomainError;
      neon.trustedDomains.push(args);
      return args.origin;
    },
  ),
}));

import { apps, coolifyAppConnections } from "@/db/schema";
import { setupHandlerTestHarness } from "@/testing/handler_test_harness";
import type { HandlerTestHarness } from "@/testing/handler_test_harness";
import { createFakeClock, type FakeClock } from "@/state_machines/testing";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { runDeployPipeline, type DeployReporter } from "./commands";

const POLL_INTERVAL_MS = 5_000;
const APP_UUID = "app-uuid-1";

interface Call {
  method: string;
  url: string;
  body: any;
  signal?: AbortSignal | null;
}

interface Reply {
  status?: number;
  body?: unknown;
}

let calls: Call[] = [];
/** Replies per route; the last one repeats once a sequence is exhausted. */
let routes: Map<string, Reply[]>;
/** Runs when a route is hit, so a test can mutate state mid-pipeline. */
let sideEffects: Map<string, () => void | Promise<void>>;

function route(key: string, body: unknown, status = 200) {
  routes.set(key, [{ body, status }]);
}

/** For endpoints whose answer changes between calls, such as a build finishing. */
function routeSequence(key: string, bodies: unknown[]) {
  routes.set(
    key,
    bodies.map((body) => ({ body, status: 200 })),
  );
}

/** Matches the request against `METHOD /path`, ignoring the host. */
function keyFor(method: string, url: string): string {
  const parsed = new URL(url);
  return `${method} ${parsed.pathname.replace("/api/v1", "")}`;
}

function installFetch() {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const key = keyFor(method, url);
    calls.push({
      method,
      url,
      body: init.body ? JSON.parse(init.body as string) : undefined,
      signal: init.signal,
    });
    await sideEffects.get(key)?.();
    const queue = routes.get(key);
    const hit: Reply =
      queue && queue.length > 0
        ? queue.length > 1
          ? queue.shift()!
          : queue[0]
        : { body: {}, status: 200 };
    return new Response(JSON.stringify(hit.body ?? {}), {
      status: hit.status ?? 200,
    });
  });
}

function coolifyCalls(): string[] {
  return calls
    .filter((c) => c.url.includes("coolify.test"))
    .map((c) => keyFor(c.method, c.url));
}

function bodyOf(key: string): any {
  return calls.find((c) => keyFor(c.method, c.url) === key)?.body;
}

function recorder(): DeployReporter & { deploymentUuid: string | null } {
  const state = { deploymentUuid: null as string | null };
  return {
    get deploymentUuid() {
      return state.deploymentUuid;
    },
    stage: () => {},
    log: () => {},
    deploymentStarted: (uuid: string) => {
      state.deploymentUuid = uuid;
    },
  };
}

/** A reporter that keeps what was written, for asserting on the deploy log. */
function loggingRecorder() {
  let text = "";
  return {
    stage: () => {},
    log: (chunk: string) => {
      text += chunk;
    },
    deploymentStarted: () => {},
    text: () => text,
  };
}

/**
 * Advances the fake clock whenever the pipeline parks on a poll interval.
 *
 * The poll loop sleeps through the injected clock, so without this the
 * pipeline never progresses past its first status check.
 */
async function drive<T>(clock: FakeClock, promise: Promise<T>): Promise<T> {
  let settled = false;
  const tracked = promise.then(
    (value) => {
      settled = true;
      return value;
    },
    (error) => {
      settled = true;
      throw error;
    },
  );
  tracked.catch(() => {});
  for (let i = 0; i < 5_000 && !settled; i++) {
    await Promise.resolve();
    if (clock.pendingTimerCount() > 0) clock.advanceBy(POLL_INTERVAL_MS);
  }
  return tracked;
}

let harness: HandlerTestHarness;

/**
 * An app plus the connection row that says where it deploys.
 *
 * The connection lives in its own table, and no row is what "not connected"
 * means — so `connection: null` seeds an app with none rather than an app
 * with seven nulls.
 */
async function seedApp(
  overrides: Partial<typeof apps.$inferInsert> & {
    connection?: Partial<typeof coolifyAppConnections.$inferInsert> | null;
  } = {},
) {
  const { connection, ...appOverrides } = overrides;
  const [row] = await harness.db
    .insert(apps)
    .values({
      name: "demo",
      path: "/tmp/dyad-demo",
      githubOrg: "acme",
      githubRepo: "demo",
      githubBranch: "main",
      ...appOverrides,
    })
    .returning();
  if (connection !== null) {
    await harness.db.insert(coolifyAppConnections).values({
      appId: row.id,
      serverUuid: "server-1",
      projectUuid: "project-1",
      environmentName: "production",
      ...connection,
    });
  }
  return row;
}

function readApp(appId: number) {
  return harness.db.query.coolifyAppConnections.findFirst({
    where: eq(coolifyAppConnections.appId, appId),
  });
}

/** Routes for a deployment that starts and immediately reports finished. */
function happyPathRoutes(uuid = APP_UUID) {
  route("GET /security/keys", [
    { uuid: "key-1", name: "dyad_acme_demo", id: 7 },
  ]);
  route("POST /applications/private-deploy-key", { uuid });
  route(`PATCH /applications/${uuid}`, {});
  route(`POST /applications/${uuid}/start`, { deployment_uuid: "dep-1" });
  route("GET /deployments/dep-1", { status: "finished" });
  route(`GET /applications/${uuid}`, {
    uuid,
    fqdn: "https://demo.sslip.io",
    private_key_id: 7,
  });
}

beforeEach(() => {
  calls = [];
  routes = new Map();
  sideEffects = new Map();
  framework.type = "vite";
  framework.declaresStart = false;
  git.uncommitted = [];
  git.hashes = { HEAD: "abc", remote: "abc" };
  neon.branchTypes = [];
  neon.trustedDomains = [];
  neon.trustedDomainError = null;
  neon.resolved = {
    databaseUrl: "postgres://prod",
    neonAuthBaseUrl: "https://auth.neon.test/db/auth",
    neonAuthCookieSecret: "cookie-secret",
    branchId: "br-prod",
    isNextJs: false,
  };
  harness = setupHandlerTestHarness();
  installFetch();
});

afterEach(() => {
  harness.dispose();
  vi.unstubAllGlobals();
});

describe("first deploy", () => {
  it("creates the application and records its uuid and URL", async () => {
    const app = await seedApp();
    happyPathRoutes();
    const clock = createFakeClock();
    const report = recorder();

    const result = await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report,
        clock,
      }),
    );

    expect(result.url).toBe("https://demo.sslip.io");
    expect(report.deploymentUuid).toBe("dep-1");
    expect(coolifyCalls()).toContain("POST /applications/private-deploy-key");
    expect(coolifyCalls()).toContain(`POST /applications/${APP_UUID}/start`);

    const saved = await readApp(app.id);
    expect(saved?.applicationUuid).toBe(APP_UUID);
    expect(saved?.appUrl).toBe("https://demo.sslip.io");
    expect(saved?.lastDeployedAt).toBeTruthy();
  });

  it("asks Coolify to generate an address when no domain is set", async () => {
    const app = await seedApp();
    happyPathRoutes();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    const created = bodyOf("POST /applications/private-deploy-key");
    expect(created.autogenerate_domain).toBe(true);
    expect(created.domains).toBeUndefined();
    // Railpack recognises a Vite app and serves the build itself, so the
    // only thing sent about it is the port Coolify insists on.
    expect(created.build_pack).toBe("railpack");
    expect(created.ports_exposes).toBe("3000");
    expect(created.start_command).toBeFalsy();
    expect(created.publish_directory).toBeFalsy();
  });
});

describe("redeploy", () => {
  it("updates the existing application without clearing its generated address", async () => {
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    expect(coolifyCalls()).not.toContain(
      "POST /applications/private-deploy-key",
    );
    const patch = bodyOf(`PATCH /applications/${APP_UUID}`);
    // Sending domains:"" here would wipe the address Coolify generated at
    // creation, and it cannot generate another.
    expect(patch).not.toHaveProperty("domains");
    expect(patch.build_pack).toBe("railpack");
  });

  it("sends the domain when the app has one", async () => {
    const app = await seedApp({
      connection: {
        applicationUuid: APP_UUID,
        domain: "https://demo.example.com",
      },
    });
    happyPathRoutes();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    expect(bodyOf(`PATCH /applications/${APP_UUID}`).domains).toBe(
      "https://demo.example.com",
    );
  });

  it("treats a hidden private_key_id as unknown rather than a mismatch", async () => {
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    // Coolify omits private_key_id for tokens without read:sensitive.
    route(`GET /applications/${APP_UUID}`, {
      uuid: APP_UUID,
      fqdn: "https://demo.sslip.io",
    });
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    expect(coolifyCalls()).not.toContain(`DELETE /applications/${APP_UUID}`);
    expect(coolifyCalls()).not.toContain(
      "POST /applications/private-deploy-key",
    );
  });
});

describe("disconnect racing a deploy", () => {
  it("does not write the application uuid back onto a cleared connection", async () => {
    const app = await seedApp();
    happyPathRoutes();
    // Disconnect lands while the create request is in flight.
    sideEffects.set("POST /applications/private-deploy-key", async () => {
      await harness.db
        .delete(coolifyAppConnections)
        .where(eq(coolifyAppConnections.appId, app.id));
    });
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    // Disconnecting deletes the row, so there is nothing for the pipeline to
    // write its application id or address onto — not a row of nulls to
    // overwrite, and not a row it could recreate.
    expect(await readApp(app.id)).toBeUndefined();
  });

  it("stops at the next abort check once cancelled", async () => {
    const app = await seedApp();
    happyPathRoutes();
    const controller = new AbortController();
    sideEffects.set("GET /security/keys", () => controller.abort());
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: controller.signal,
          report: recorder(),
          clock,
        }),
      ),
    ).rejects.toThrow(/cancelled/i);

    expect(coolifyCalls()).not.toContain(
      "POST /applications/private-deploy-key",
    );
  });
});

describe("resuming a previous deployment", () => {
  it("follows a build that is still running", async () => {
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    // Still building when adopted, finished by the first poll.
    routeSequence("GET /deployments/dep-earlier", [
      { status: "in_progress" },
      { status: "finished" },
    ]);
    const clock = createFakeClock();

    const result = await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        resumeDeploymentUuid: "dep-earlier",
        clock,
      }),
    );

    // Adopted rather than queueing a second build on a busy server.
    expect(coolifyCalls()).not.toContain(
      `POST /applications/${APP_UUID}/start`,
    );
    expect(result.url).toBe("https://demo.sslip.io");
  });

  it("starts fresh when the previous deployment already finished", async () => {
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    route("GET /deployments/dep-earlier", { status: "failed" });
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        resumeDeploymentUuid: "dep-earlier",
        clock,
      }),
    );

    expect(coolifyCalls()).toContain(`POST /applications/${APP_UUID}/start`);
  });

  it("keeps the application id when the removal failed", async () => {
    // The old application is still running and likely still holding the
    // domain, which is why the replacement cannot be created.
    const app = await seedApp({
      connection: { applicationUuid: "stale-uuid", appUrl: "https://old.test" },
    });
    happyPathRoutes();
    route("GET /applications/stale-uuid", {
      uuid: "stale-uuid",
      private_key_id: 999,
    });
    route("DELETE /applications/stale-uuid", { message: "denied" }, 500);
    route("POST /applications/private-deploy-key", { message: "in use" }, 409);
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: new AbortController().signal,
          report: recorder(),
          clock,
        }),
      ),
    ).rejects.toThrow();

    const saved = await readApp(app.id);
    expect(saved?.applicationUuid).toBe("stale-uuid");
    expect(saved?.appUrl).toBe("https://old.test");
  });

  it("forgets the application id once the removal succeeded", async () => {
    // The replacement could not be created, but the old application is gone
    // all the same — so the panel must stop offering its address.
    const app = await seedApp({
      connection: { applicationUuid: "stale-uuid", appUrl: "https://old.test" },
    });
    happyPathRoutes();
    route("GET /applications/stale-uuid", {
      uuid: "stale-uuid",
      private_key_id: 999,
    });
    route("DELETE /applications/stale-uuid", {});
    route("POST /applications/private-deploy-key", { message: "nope" }, 409);
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: new AbortController().signal,
          report: recorder(),
          clock,
        }),
      ),
    ).rejects.toThrow();

    const saved = await readApp(app.id);
    expect(saved?.applicationUuid).toBeNull();
  });

  it("forgets the application id when Coolify no longer has it", async () => {
    // A 404 settles it, so the panel must stop offering that address.
    const app = await seedApp({
      connection: { applicationUuid: "gone-uuid", appUrl: "https://old.test" },
    });
    happyPathRoutes();
    route("GET /applications/gone-uuid", { message: "not found" }, 404);
    route("POST /applications/private-deploy-key", { message: "in use" }, 409);
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: new AbortController().signal,
          report: recorder(),
          clock,
        }),
      ),
    ).rejects.toThrow();

    const saved = await readApp(app.id);
    expect(saved?.applicationUuid).toBeNull();
  });

  it("drops the resumed deployment when the application was recreated", async () => {
    const app = await seedApp({
      connection: { applicationUuid: "stale-uuid" },
    });
    happyPathRoutes();
    // The saved application clones with an outdated key, so it is replaced.
    route("GET /applications/stale-uuid", {
      uuid: "stale-uuid",
      private_key_id: 999,
    });
    route("DELETE /applications/stale-uuid", {});
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        resumeDeploymentUuid: "dep-earlier",
        clock,
      }),
    );

    // That deployment belonged to the application that was just deleted.
    expect(coolifyCalls()).not.toContain("GET /deployments/dep-earlier");
    expect(coolifyCalls()).toContain(`POST /applications/${APP_UUID}/start`);
  });
});

describe("polling", () => {
  it("fails with the deployment log when the build fails", async () => {
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    route("GET /deployments/dep-1", {
      status: "failed",
      logs: "npm ERR! build blew up",
    });
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: new AbortController().signal,
          report: recorder(),
          clock,
        }),
      ),
    ).rejects.toThrow(/did not finish \(last status: failed\)/);
  });

  it("shows the builder's output rather than the JSON it arrives in", async () => {
    // Coolify sends the log as an encoded array, so piping it through put a
    // blob of escaped newlines and quoting in front of the user — and the
    // e2e assertion passed only by substring-matching inside it.
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    route("GET /deployments/dep-1", {
      status: "failed",
      logs: JSON.stringify([
        { output: "npm ERR! build blew up" },
        { output: "npm ERR! exit 1" },
      ]),
    });
    const report = loggingRecorder();
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: new AbortController().signal,
          report,
          clock,
        }),
      ),
    ).rejects.toThrow(/did not finish/);

    const text = report.text();
    expect(text).toContain("npm ERR! build blew up\nnpm ERR! exit 1");
    // And none of the wrapping survives, which is what makes it readable.
    expect(text).not.toContain('{"output"');
    expect(text).not.toContain("\\n");
  });

  it("keeps a log that is not encoded that way", async () => {
    // An instance reporting plain text should not lose its log to a parse
    // that was only ever a best guess about the shape.
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    route("GET /deployments/dep-1", {
      status: "failed",
      logs: "plain text failure",
    });
    const report = loggingRecorder();
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: new AbortController().signal,
          report,
          clock,
        }),
      ),
    ).rejects.toThrow(/did not finish/);

    expect(report.text()).toContain("plain text failure");
  });

  it("does not repeat a status that has not changed, but says it is alive", async () => {
    // The loop polls every five seconds, and printing each answer put a line
    // a second-and-change apart for the whole build.
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    routeSequence("GET /deployments/dep-1", [
      ...Array.from({ length: 8 }, () => ({ status: "building" })),
      { status: "finished" },
    ]);
    const report = loggingRecorder();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report,
        clock,
      }),
    );

    const text = report.text();
    expect(text.match(/status: building/g)).toHaveLength(1);
    expect(text).toContain("status: finished");
    // Eight polls of "building" is forty seconds, so exactly one of these —
    // enough that the log is visibly still moving, at a readable rate.
    expect(text.match(/still building/g)).toHaveLength(1);
    expect(text).toContain("still building (35s)");
  });

  it("explains an out-of-memory kill rather than reporting a bare exit status", async () => {
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    route("GET /deployments/dep-1", {
      status: "failed",
      // The shape Coolify sends. Matched against the plain text, not the
      // JSON: the phrase surviving encoding was luck, not design.
      logs: JSON.stringify([{ output: "exit status -1" }]),
    });
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: new AbortController().signal,
          report: recorder(),
          clock,
        }),
      ),
    ).rejects.toThrow(/ran out of memory or disk/);
  });

  it("gives up once the poll timeout elapses on the injected clock", async () => {
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    route("GET /deployments/dep-1", { status: "in_progress" });
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: new AbortController().signal,
          report: recorder(),
          clock,
        }),
      ),
    ).rejects.toThrow(/did not finish/);

    // 15 minutes of polling, with no real time spent.
    expect(clock.now()).toBeGreaterThanOrEqual(15 * 60 * 1000);
  });
});

describe("build configuration", () => {
  it("gives a Nitro-backed Vite app a start command and its own port", async () => {
    // Adding a Neon database turns a Vite app into this shape.
    framework.type = "vite-nitro";
    const app = await seedApp();
    happyPathRoutes();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    const created = bodyOf("POST /applications/private-deploy-key");
    expect(created.build_pack).toBe("railpack");
    expect(created.ports_exposes).toBe("3000");
    expect(created.start_command).toBe("node .output/server/index.mjs");
  });

  it("leaves a static Vite app with no start command", async () => {
    const app = await seedApp();
    happyPathRoutes();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    expect(
      bodyOf("POST /applications/private-deploy-key").start_command,
    ).toBeUndefined();
  });

  it("builds a non-Vite app as a server on port 3000", async () => {
    framework.type = "nextjs";
    const app = await seedApp();
    happyPathRoutes();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    const created = bodyOf("POST /applications/private-deploy-key");
    expect(created.build_pack).toBe("railpack");
    expect(created.ports_exposes).toBe("3000");
    // Nothing else is claimed about an app Dyad does not recognise, so railpack
    // reads it and decides for itself.
    expect(created.start_command).toBeUndefined();
    expect(created.publish_directory).toBeUndefined();
    expect(created.is_static).toBeUndefined();
  });
});

describe("preconditions", () => {
  it("refuses an app with no GitHub repository", async () => {
    const app = await seedApp({ githubOrg: null, githubRepo: null });
    const clock = createFakeClock();

    await expect(
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    ).rejects.toThrow(/Connect this app to GitHub first/);
  });

  it("refuses an app with no Coolify server", async () => {
    const app = await seedApp({ connection: null });
    const clock = createFakeClock();

    await expect(
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    ).rejects.toThrow(/Connect a Coolify server/);
  });
});

describe("losing contact with Coolify", () => {
  it("fails with the transport error instead of stalling until the timeout", async () => {
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    // The instance answers the start call, then stops responding.
    route("GET /deployments/dep-1", { message: "gone" }, 502);
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: new AbortController().signal,
          report: recorder(),
          clock,
        }),
      ),
    ).rejects.toThrow(/Lost contact with Coolify/);

    // Gave up after ~a minute of failures, not after the 15-minute timeout.
    expect(clock.now()).toBeLessThan(15 * 60 * 1000);
  });

  it("rides out a blip and still finishes", async () => {
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    routes.set("GET /deployments/dep-1", [
      { status: 502, body: { message: "blip" } },
      { status: 200, body: { status: "finished" } },
    ]);
    const clock = createFakeClock();

    const result = await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    expect(result.url).toBe("https://demo.sslip.io");
  });
});

describe("deploying to an instance the app does not belong to", () => {
  it("refuses rather than treating the 404 as a deleted application", async () => {
    // The application id is the one value a user cannot re-enter, and the
    // application is still running on the instance they left. Recreating here
    // would build a second one beside it and lose the handle to the first.
    framework.type = "nextjs";
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    route(`GET /applications/${APP_UUID}`, {}, 404);
    // The instance answers, but the server this app is pinned to is not on it.
    route("GET /servers", [{ uuid: "srv-somewhere-else", name: "other" }]);
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: new AbortController().signal,
          report: recorder(),
          clock,
        }),
      ),
    ).rejects.toThrow(/not on the Coolify instance/);

    const row = await readApp(app.id);
    expect(row?.applicationUuid).toBe(APP_UUID);
  });
});

describe("recreating an application", () => {
  it("does not blank a newer deployment's uuid after being cancelled", async () => {
    const app = await seedApp({
      connection: { applicationUuid: "stale-uuid" },
    });
    happyPathRoutes();
    route("GET /applications/stale-uuid", {}, 404);
    const controller = new AbortController();
    // Cancellation lands while we are still asking about the old application.
    sideEffects.set("GET /applications/stale-uuid", () => controller.abort());
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: controller.signal,
          report: recorder(),
          clock,
        }),
      ),
    ).rejects.toThrow(/cancelled/i);

    const saved = await readApp(app.id);
    expect(saved?.applicationUuid).toBe("stale-uuid");
  });
});

describe("database env vars", () => {
  /** Env vars the pipeline pushed, in the order it set them. */
  function envCalls(): Array<{ key: string; value: string }> {
    return calls
      .filter((c) => keyFor(c.method, c.url).endsWith("/envs"))
      .map((c) => ({ key: c.body.key, value: c.body.value }));
  }

  it("wires the auth base URL too, not just the connection string", async () => {
    // Without NEON_AUTH_BASE_URL the app builds and starts, then answers every
    // request that touches a session with a 500.
    const app = await seedApp({ neonProjectId: "proj-1" });
    happyPathRoutes();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    expect(envCalls()).toEqual([
      { key: "DATABASE_URL", value: "postgres://prod" },
      { key: "NEON_AUTH_BASE_URL", value: "https://auth.neon.test/db/auth" },
    ]);
  });

  it("honours the branch the user picked for deployment", async () => {
    const app = await seedApp({
      neonProjectId: "proj-1",
      selectedDatabaseBranchType: "development",
    });
    happyPathRoutes();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    // Deploying production when the user asked for the development branch
    // fails in the dangerous direction.
    expect(neon.branchTypes).toEqual(["development"]);
  });

  it("defaults to the production branch when nothing was picked", async () => {
    const app = await seedApp({ neonProjectId: "proj-1" });
    happyPathRoutes();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    expect(neon.branchTypes).toEqual(["production"]);
  });

  it("sets a cookie secret only for Next.js, which signs its own cookies", async () => {
    framework.type = "nextjs";
    neon.resolved = { ...neon.resolved, isNextJs: true };
    const app = await seedApp({ neonProjectId: "proj-1" });
    happyPathRoutes();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    expect(envCalls().map((e) => e.key)).toEqual([
      "DATABASE_URL",
      "NEON_AUTH_BASE_URL",
      "NEON_AUTH_COOKIE_SECRET",
    ]);
  });

  it("sets nothing for an app with no database", async () => {
    const app = await seedApp();
    happyPathRoutes();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    expect(envCalls()).toEqual([]);
  });
});

describe("Neon Auth trusted domains", () => {
  it("allows sign-in from the deployed URL", async () => {
    // Without this Neon Auth answers "Invalid origin" and the app deploys
    // successfully but nobody can log in.
    const app = await seedApp({ neonProjectId: "proj-1" });
    happyPathRoutes();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    expect(neon.trustedDomains).toEqual([
      {
        projectId: "proj-1",
        branchId: "br-prod",
        origin: "https://demo.sslip.io",
      },
    ]);
  });

  it("does not register anything when the app has no auth", async () => {
    neon.resolved = { ...neon.resolved, neonAuthBaseUrl: undefined };
    const app = await seedApp({ neonProjectId: "proj-1" });
    happyPathRoutes();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    expect(neon.trustedDomains).toEqual([]);
  });

  it("still reports success when Neon rejects the registration", async () => {
    // The app is already live by this point; failing the deploy would be worse
    // than a deploy that logs why sign-in might not work.
    neon.trustedDomainError = new Error("neon is down");
    const app = await seedApp({ neonProjectId: "proj-1" });
    happyPathRoutes();
    const clock = createFakeClock();

    const result = await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    expect(result.url).toBe("https://demo.sslip.io");
  });
});

describe("starting the build", () => {
  it("fails clearly when Coolify returns no deployment to follow", async () => {
    // A 2xx with only a message means Coolify declined to queue the build.
    // Falling through the poll loop would report a status never asked for.
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    route(`POST /applications/${APP_UUID}/start`, {
      message: "already queued",
    });
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: new AbortController().signal,
          report: recorder(),
          clock,
        }),
      ),
    ).rejects.toThrow(/returned no deployment to follow/);
  });

  it("does not claim a status it never asked for", async () => {
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    route(`POST /applications/${APP_UUID}/start`, {});
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: new AbortController().signal,
          report: recorder(),
          clock,
        }),
      ),
    ).rejects.not.toThrow(/last status: unknown/);
  });
});

describe("adopting a previous deployment", () => {
  it("does not start a second build when the status lookup fails", async () => {
    // The retry exists because the earlier build may still be running; reading
    // a transient failure as "not running" queues a second one beside it.
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    route("GET /deployments/dep-earlier", { message: "gateway" }, 502);
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: new AbortController().signal,
          report: recorder(),
          resumeDeploymentUuid: "dep-earlier",
          clock,
        }),
      ),
    ).rejects.toThrow();

    expect(coolifyCalls()).not.toContain(
      `POST /applications/${APP_UUID}/start`,
    );
  });

  it("starts fresh when the deployment is genuinely gone", async () => {
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    route("GET /deployments/dep-earlier", { message: "not found" }, 404);
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        resumeDeploymentUuid: "dep-earlier",
        clock,
      }),
    );

    expect(coolifyCalls()).toContain(`POST /applications/${APP_UUID}/start`);
  });
});

/**
 * Deciding whether the key GitHub already holds is ours.
 *
 * The answer chooses between carrying on and telling the user their key
 * belongs to another repository — a message that asks them to delete a key. A
 * default page holds thirty, so a repository with more than that could hide
 * our own key behind the first page and earn them that advice wrongly.
 */
describe("checking a deploy key GitHub reports as already in use", () => {
  const OURS = "ssh-ed25519 AAAAPUBLIC comment";

  function filler(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      key: `ssh-ed25519 AAAAOTHER${i} someone-else`,
    }));
  }

  it("keeps paging until it finds the key it holds", async () => {
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    route(
      "POST /api/repos/acme/demo/keys",
      { message: "key is already in use" },
      422,
    );
    // A full page of other people's keys, then ours on the next one.
    routeSequence("GET /api/repos/acme/demo/keys", [
      filler(100),
      [{ key: OURS }],
    ]);
    const report = loggingRecorder();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report,
        clock,
      }),
    );

    expect(report.text()).toContain("Deploy key already present");
  });

  it("still reports a key that really is on another repository", async () => {
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    route(
      "POST /api/repos/acme/demo/keys",
      { message: "key is already in use" },
      422,
    );
    // A short page is the last one, and ours is not on it.
    routeSequence("GET /api/repos/acme/demo/keys", [filler(3)]);
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: new AbortController().signal,
          report: recorder(),
          clock,
        }),
      ),
    ).rejects.toThrow(/already registered on a different repository/);
  });
});

describe("pre-deploy warnings", () => {
  it("warns when the branch has commits that are not on GitHub", async () => {
    // Coolify clones from GitHub, so unpushed work is silently not deployed.
    git.hashes = { HEAD: "local-newer", remote: "older" };
    const app = await seedApp();
    happyPathRoutes();
    const report = loggingRecorder();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report,
        clock,
      }),
    );

    expect(report.text()).toMatch(/not on origin\/main/);
  });

  it("still reports edits on disk when there is no origin ref to compare", async () => {
    // The remote lookup throws for a branch that was never pushed. Sharing a
    // try with the working-tree check meant that throw swallowed it, in the
    // one case where nothing whatsoever is on GitHub.
    git.hashes.remote = "__throw__";
    git.uncommitted = ["src/App.tsx"];
    const app = await seedApp();
    happyPathRoutes();
    const report = loggingRecorder();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report,
        clock,
      }),
    );

    expect(report.text()).toMatch(/1 uncommitted file/);
    expect(report.text()).toMatch(/never been pushed/);
  });

  it("says when edits are only on disk, which no commit hash reveals", async () => {
    // Deploying what is on GitHub is the intent, but uncommitted work does
    // not move HEAD, so the push check above cannot see it. A user looking at
    // edits Dyad just made would otherwise get a green deploy without them.
    git.uncommitted = ["src/App.tsx", "src/main.tsx"];
    const app = await seedApp();
    happyPathRoutes();
    const report = loggingRecorder();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report,
        clock,
      }),
    );

    expect(report.text()).toMatch(/2 uncommitted files/);
  });

  it("says nothing when the branch is pushed", async () => {
    const app = await seedApp();
    happyPathRoutes();
    const report = loggingRecorder();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report,
        clock,
      }),
    );

    expect(report.text()).not.toMatch(/not on origin/);
  });

  it("warns when deploying a Neon branch the app was not built against", async () => {
    // The publish-panel default is production; the agent builds tables on
    // whichever branch is active locally, usually development.
    const app = await seedApp({
      neonProjectId: "proj-1",
      neonActiveBranchId: "br-dev",
    });
    happyPathRoutes();
    const report = loggingRecorder();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report,
        clock,
      }),
    );

    expect(report.text()).toMatch(/different Neon branch/);
  });

  it("warns for an app connected before there was an active branch", async () => {
    // neon_active_branch_id arrived in migration 0027 with no backfill, so
    // every app connected before then has only a development branch — and the
    // rest of the Neon code treats that as the effective one.
    const app = await seedApp({
      neonProjectId: "proj-1",
      neonActiveBranchId: null,
      neonDevelopmentBranchId: "br-dev",
    });
    happyPathRoutes();
    const report = loggingRecorder();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report,
        clock,
      }),
    );

    expect(report.text()).toMatch(/different Neon branch/);
  });

  it("says nothing when deploying the branch the app develops on", async () => {
    const app = await seedApp({
      neonProjectId: "proj-1",
      neonActiveBranchId: "br-prod",
    });
    happyPathRoutes();
    const report = loggingRecorder();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report,
        clock,
      }),
    );

    expect(report.text()).not.toMatch(/different Neon branch/);
  });
});

describe("database resolution failures", () => {
  it("keeps the kind Neon assigned rather than reporting every failure as a crash", async () => {
    // rules/dyad-errors.md keeps Precondition out of telemetry; rewrapping it
    // as External would report a missing branch as a crash on every deploy.
    const { resolveNeonBranchEnvVars } = await import("@/ipc/utils/neon_utils");
    vi.mocked(resolveNeonBranchEnvVars).mockRejectedValueOnce(
      new DyadError(
        "This app has no development branch.",
        DyadErrorKind.Precondition,
      ),
    );
    const app = await seedApp({ neonProjectId: "proj-1" });
    happyPathRoutes();
    const clock = createFakeClock();

    const error = await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    ).catch((e) => e);

    expect(error.kind).toBe(DyadErrorKind.Precondition);
    expect(error.message).toBe("This app has no development branch.");
  });

  it("still classifies an unrecognised failure as external", async () => {
    const { resolveNeonBranchEnvVars } = await import("@/ipc/utils/neon_utils");
    vi.mocked(resolveNeonBranchEnvVars).mockRejectedValueOnce(
      new Error("socket hang up"),
    );
    const app = await seedApp({ neonProjectId: "proj-1" });
    happyPathRoutes();
    const clock = createFakeClock();

    const error = await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    ).catch((e) => e);

    expect(error.kind).toBe(DyadErrorKind.External);
    expect(error.message).toMatch(/socket hang up/);
  });
});

describe("cancelling during deploy-key setup", () => {
  it("gives the GitHub requests a signal that cancels with the deploy", async () => {
    // The Coolify client carries the signal; the GitHub calls have to as well,
    // or cancelling does nothing until the pipeline reaches Coolify.
    const app = await seedApp();
    happyPathRoutes();
    const controller = new AbortController();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: controller.signal,
        report: recorder(),
        clock,
      }),
    );

    const githubCall = calls.find((c) => c.url.includes("github.test"));
    expect(githubCall?.signal).toBeInstanceOf(AbortSignal);
    expect(githubCall!.signal!.aborted).toBe(false);
    // Cancelling the deploy aborts the signal that request was given.
    controller.abort();
    expect(githubCall!.signal!.aborted).toBe(true);
  });
});

describe("keeping the Coolify application in step with the repo", () => {
  it("sends the current branch when reusing an application", async () => {
    // The application keeps whatever branch it was created with, so a user who
    // switches branches would otherwise redeploy the old source.
    const app = await seedApp({
      githubBranch: "feature",
      connection: { applicationUuid: APP_UUID },
    });
    happyPathRoutes();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    const patch = bodyOf(`PATCH /applications/${APP_UUID}`);
    expect(patch.git_branch).toBe("feature");
    expect(patch.git_repository).toBe("git@github.com:acme/demo.git");
  });

  it("leaves settings it has no opinion on untouched", async () => {
    // A redeploy that rewrote every field would replace anything the user set
    // in Coolify, and anything an app configured for itself, with a default
    // Dyad invented. Only what Dyad actually has a value for is sent.
    framework.type = "nextjs";
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    const patch = bodyOf(`PATCH /applications/${APP_UUID}`);
    expect(patch.build_pack).toBe("railpack");
    expect(patch.ports_exposes).toBe("3000");
    // Absent from the request entirely, not set to an empty string.
    expect("publish_directory" in patch).toBe(false);
    expect("start_command" in patch).toBe(false);
    expect("is_static" in patch).toBe(false);
    expect("is_spa" in patch).toBe(false);
  });
});

describe("surviving a failed resume", () => {
  it("still reports the adopted deployment when the probe fails", async () => {
    // The machine keeps this id into the failed state, so the next retry can
    // adopt the build that is still running instead of being refused forever.
    const app = await seedApp({ connection: { applicationUuid: APP_UUID } });
    happyPathRoutes();
    route("GET /deployments/dep-earlier", { message: "gateway" }, 502);
    const report = recorder();
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: new AbortController().signal,
          report,
          clock,
          resumeDeploymentUuid: "dep-earlier",
        }),
      ),
    ).rejects.toThrow();

    expect(report.deploymentUuid).toBe("dep-earlier");
  });
});

describe("writing only to the server the deploy started against", () => {
  it("does not record the result when the app was repointed mid-deploy", async () => {
    // A deploy can run for fifteen minutes. If the user disconnects and
    // reconnects to a different Coolify meanwhile, this application id and URL
    // exist only on the instance this pipeline was talking to.
    const app = await seedApp({ connection: { applicationUuid: null } });
    happyPathRoutes();
    const clock = createFakeClock();

    // Repointed while the application is being created, so the write that
    // follows names a connection that is gone. Hooked to the request rather
    // than raced against the pipeline, or whether this lands first is a matter
    // of how many microtasks the pipeline happens to take.
    //
    // Replaced rather than updated in place, which is what saving a connection
    // does: the row is deleted and written back, so it is a different row.
    sideEffects.set("POST /applications/private-deploy-key", async () => {
      await harness.db
        .delete(coolifyAppConnections)
        .where(eq(coolifyAppConnections.appId, app.id));
      await harness.db.insert(coolifyAppConnections).values({
        appId: app.id,
        serverUuid: "srv-other",
        projectUuid: "project-1",
        environmentName: "production",
      });
    });

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    // The row moved to another server, so the fenced write matched nothing
    // and left it describing the server it was repointed to.
    const row = await readApp(app.id);
    expect(row?.serverUuid).toBe("srv-other");
    expect(row?.applicationUuid).toBeNull();
    expect(row?.appUrl).toBeNull();
  });

  it("does not record the result on a connection made after this one went", async () => {
    // Disconnect cancels the deploy and deletes the row, but the pipeline is
    // still unwinding. Reconnecting to the very same server, project and
    // environment gives a row every host column matches — so a fence naming
    // where it deploys, rather than which connection it is, hands the
    // abandoned application and address to its replacement.
    const app = await seedApp({ connection: { applicationUuid: null } });
    happyPathRoutes();
    const clock = createFakeClock();

    sideEffects.set("POST /applications/private-deploy-key", async () => {
      await harness.db
        .delete(coolifyAppConnections)
        .where(eq(coolifyAppConnections.appId, app.id));
      await harness.db.insert(coolifyAppConnections).values({
        appId: app.id,
        serverUuid: "server-1",
        projectUuid: "project-1",
        environmentName: "production",
        domain: null,
      });
    });

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    const row = await readApp(app.id);
    expect(row?.serverUuid).toBe("server-1");
    expect(row?.applicationUuid).toBeNull();
    expect(row?.appUrl).toBeNull();
  });

  it("does not record the result when only the project changed", async () => {
    // Same server, different project: still somewhere else. Without this, what
    // lands is an application belonging to the old project, hung on a
    // connection naming the new one — and it resolves cleanly on the next
    // deploy, so nothing ever surfaces the mismatch.
    const app = await seedApp({ connection: { applicationUuid: null } });
    happyPathRoutes();
    const clock = createFakeClock();

    sideEffects.set("POST /applications/private-deploy-key", async () => {
      await harness.db
        .delete(coolifyAppConnections)
        .where(eq(coolifyAppConnections.appId, app.id));
      await harness.db.insert(coolifyAppConnections).values({
        appId: app.id,
        serverUuid: "server-1",
        projectUuid: "project-other",
        environmentName: "production",
      });
    });

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    );

    const row = await readApp(app.id);
    expect(row?.projectUuid).toBe("project-other");
    expect(row?.applicationUuid).toBeNull();
    expect(row?.appUrl).toBeNull();
  });
});

describe("failing after the old application is already gone", () => {
  /** A saved application that clones with a key Coolify no longer has. */
  async function seedStaleKeyApp() {
    const app = await seedApp({
      connection: { applicationUuid: "stale-uuid" },
    });
    happyPathRoutes();
    route("GET /applications/stale-uuid", {
      uuid: "stale-uuid",
      private_key_id: 999,
    });
    route("DELETE /applications/stale-uuid", {});
    return app;
  }

  it("says the app is down when the replacement cannot be created", async () => {
    // Deleting is what takes the site offline, and it happens before Coolify
    // has agreed to build a replacement. The failure on its own reads like
    // nothing happened; what the user needs is that their app is not running.
    const app = await seedStaleKeyApp();
    route("POST /applications/private-deploy-key", { message: "boom" }, 500);
    const report = loggingRecorder();
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: new AbortController().signal,
          report,
          clock,
        }),
      ),
    ).rejects.toThrow();

    expect(report.text()).toContain("is not running until a deploy succeeds");
  });

  it("hands the failure on exactly as it arrived", async () => {
    // The regression this guards against is the log line being bought with a
    // rethrow, which would flatten every failure here to one kind. Telemetry
    // filters on kind — Auth is dropped, External is reported — so a wrapper
    // would start sending the user's failed logins to the backend.
    //
    // Deliberately a 401 rather than a 500: a 500 is already External, so a
    // wrapper that reports External would pass a test written against one
    // while changing nothing it asserts. This fails unless the original
    // error is what propagates.
    const app = await seedStaleKeyApp();
    route("POST /applications/private-deploy-key", { message: "nope" }, 401);
    const clock = createFakeClock();

    const error = await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report: recorder(),
        clock,
      }),
    ).catch((e) => e);

    expect(isDyadError(error)).toBe(true);
    expect(error.kind).toBe(DyadErrorKind.Auth);
  });

  it("stays quiet when nothing was removed", async () => {
    // The application was already gone from Coolify, so this deploy did not
    // take anything down and must not claim it did.
    const app = await seedApp({ connection: { applicationUuid: "gone-1" } });
    happyPathRoutes();
    route("GET /applications/gone-1", { message: "Not found." }, 404);
    route("POST /applications/private-deploy-key", { message: "boom" }, 500);
    const report = loggingRecorder();
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: new AbortController().signal,
          report,
          clock,
        }),
      ),
    ).rejects.toThrow();

    expect(report.text()).not.toContain("is not running until a deploy");
  });

  it("does not claim the old application survived a cancelled removal", async () => {
    // The client cancels through the deploy's own signal, so a disconnect
    // lands in the same catch as a refusal — but Coolify may well have
    // processed the delete before the connection went away. Saying it is
    // still on the server sends the user looking for something that may not
    // be there, and away from an application that may be gone.
    const app = await seedStaleKeyApp();
    const controller = new AbortController();
    sideEffects.set("DELETE /applications/stale-uuid", () => {
      controller.abort();
      throw new Error("connection closed");
    });
    const report = loggingRecorder();
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: controller.signal,
          report,
          clock,
        }),
      ),
    ).rejects.toThrow();

    expect(report.text()).toContain("may or may not still be on your server");
    expect(report.text()).not.toContain("it is still on your server");
    // Nothing was confirmed removed, so the down-message must not fire either.
    expect(report.text()).not.toContain("is not running until a deploy");
  });

  it("stays quiet when the replacement is created", async () => {
    // The common case of this branch is an ordinary successful rotation, and
    // a warning that the app is down would be false on every one of them.
    const app = await seedStaleKeyApp();
    const report = loggingRecorder();
    const clock = createFakeClock();

    await drive(
      clock,
      runDeployPipeline({
        appId: app.id,
        signal: new AbortController().signal,
        report,
        clock,
      }),
    );

    expect(report.text()).not.toContain("is not running until a deploy");
  });
});

describe("replacing an application", () => {
  it("clears the URL the replaced application was reachable at", async () => {
    // The old address belonged to the application Coolify no longer has, so
    // the panel must not keep offering a link to it.
    const app = await seedApp({
      connection: {
        applicationUuid: "gone-1",
        appUrl: "https://old.example.com",
      },
    });
    happyPathRoutes();
    route("GET /applications/gone-1", { message: "not found" }, 404);
    // Stop before the deploy can write a fresh URL, so the assertion is about
    // the recreate having cleared the old one rather than about the deploy.
    route(`POST /applications/${APP_UUID}/start`, { message: "boom" }, 500);
    const clock = createFakeClock();

    await expect(
      drive(
        clock,
        runDeployPipeline({
          appId: app.id,
          signal: new AbortController().signal,
          report: recorder(),
          clock,
        }),
      ),
    ).rejects.toThrow();

    const row = await readApp(app.id);
    expect(row?.applicationUuid).toBe(APP_UUID);
    expect(row?.appUrl).toBeNull();
  });
});
