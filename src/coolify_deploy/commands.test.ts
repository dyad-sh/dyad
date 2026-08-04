import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// The pipeline reads settings through this module directly, so the harness's
// in-memory settings would not reach it. writeSettings and DEFAULT_SETTINGS are
// here because the handler harness and its context module import them too.
vi.mock("@/main/settings", () => ({
  readSettings: () => ({
    coolifyInstanceUrl: "https://coolify.test",
    coolifyAccessToken: { value: "token" },
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
  hashes: { HEAD: "abc", remote: "abc" } as Record<string, string>,
}));
vi.mock("@/ipc/utils/git_utils", () => ({
  getCurrentCommitHash: async ({ ref }: { ref: string }) =>
    ref === "HEAD" ? git.hashes.HEAD : git.hashes.remote,
}));

// Real key handling spawns ssh-keygen and writes to ~/.ssh.
vi.mock("@/ipc/utils/coolify_deploy_key", () => ({
  repoKeyName: (owner: string, repo: string) => `dyad_${owner}_${repo}`,
  // Identity here: the fingerprint suffix is this module's own concern, and
  // routing it through would only make every route name in these tests noisier.
  coolifyKeyName: (keyName: string) => keyName,
  ensureDeployKey: vi.fn(async (name: string) => name),
  readPublicKey: () => "ssh-ed25519 AAAAPUBLIC comment",
  readPrivateKey: () => "PRIVATE",
}));

const framework = vi.hoisted(() => ({ type: "vite" as string | null }));
vi.mock("@/ipc/utils/framework_utils", () => ({
  detectFrameworkType: () => framework.type,
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

import { apps } from "@/db/schema";
import { setupHandlerTestHarness } from "@/testing/handler_test_harness";
import type { HandlerTestHarness } from "@/testing/handler_test_harness";
import { createFakeClock, type FakeClock } from "@/state_machines/testing";
import { runDeployPipeline, type DeployReporter } from "./commands";

const POLL_INTERVAL_MS = 5_000;
const APP_UUID = "app-uuid-1";

interface Call {
  method: string;
  url: string;
  body: any;
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

async function seedApp(overrides: Partial<typeof apps.$inferInsert> = {}) {
  const [row] = await harness.db
    .insert(apps)
    .values({
      name: "demo",
      path: "/tmp/dyad-demo",
      githubOrg: "acme",
      githubRepo: "demo",
      githubBranch: "main",
      coolifyServerUuid: "server-1",
      coolifyProjectUuid: "project-1",
      coolifyEnvironmentName: "production",
      ...overrides,
    })
    .returning();
  return row;
}

function readApp(appId: number) {
  return harness.db.query.apps.findFirst({ where: eq(apps.id, appId) });
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
    expect(saved?.coolifyApplicationUuid).toBe(APP_UUID);
    expect(saved?.coolifyAppUrl).toBe("https://demo.sslip.io");
    expect(saved?.coolifyLastDeployedAt).toBeTruthy();
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
    // A Vite app compiles to static files, which nixpacks cannot start.
    expect(created.build_pack).toBe("railpack");
    expect(created.is_static).toBe(true);
    expect(created.is_spa).toBe(true);
  });
});

describe("redeploy", () => {
  it("updates the existing application without clearing its generated address", async () => {
    const app = await seedApp({ coolifyApplicationUuid: APP_UUID });
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
      coolifyApplicationUuid: APP_UUID,
      coolifyDomain: "https://demo.example.com",
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
    const app = await seedApp({ coolifyApplicationUuid: APP_UUID });
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
        .update(apps)
        .set({
          coolifyServerUuid: null,
          coolifyProjectUuid: null,
          coolifyApplicationUuid: null,
          coolifyAppUrl: null,
        })
        .where(eq(apps.id, app.id));
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

    const saved = await readApp(app.id);
    expect(saved?.coolifyApplicationUuid).toBeNull();
    expect(saved?.coolifyAppUrl).toBeNull();
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
    const app = await seedApp({ coolifyApplicationUuid: APP_UUID });
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
    const app = await seedApp({ coolifyApplicationUuid: APP_UUID });
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

  it("drops the resumed deployment when the application was recreated", async () => {
    const app = await seedApp({ coolifyApplicationUuid: "stale-uuid" });
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
    const app = await seedApp({ coolifyApplicationUuid: APP_UUID });
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

  it("explains an out-of-memory kill rather than reporting a bare exit status", async () => {
    const app = await seedApp({ coolifyApplicationUuid: APP_UUID });
    happyPathRoutes();
    route("GET /deployments/dep-1", {
      status: "failed",
      logs: "exit status -1",
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
    const app = await seedApp({ coolifyApplicationUuid: APP_UUID });
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
    expect(created.is_static).toBe(false);
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
    expect(created.build_pack).toBe("nixpacks");
    expect(created.ports_exposes).toBe("3000");
    expect(created.is_static).toBe(false);
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
    const app = await seedApp({ coolifyServerUuid: null });
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
    const app = await seedApp({ coolifyApplicationUuid: APP_UUID });
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
    const app = await seedApp({ coolifyApplicationUuid: APP_UUID });
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

describe("recreating an application", () => {
  it("does not blank a newer deployment's uuid after being cancelled", async () => {
    const app = await seedApp({ coolifyApplicationUuid: "stale-uuid" });
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
    expect(saved?.coolifyApplicationUuid).toBe("stale-uuid");
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
    const app = await seedApp({ coolifyApplicationUuid: APP_UUID });
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
    const app = await seedApp({ coolifyApplicationUuid: APP_UUID });
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
    const app = await seedApp({ coolifyApplicationUuid: APP_UUID });
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
    const app = await seedApp({ coolifyApplicationUuid: APP_UUID });
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

describe("pre-deploy warnings", () => {
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
