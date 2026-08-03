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

// Only reached for apps with a Neon project; kept out of the import graph.
vi.mock("@/ipc/utils/neon_utils", () => ({
  getProductionBranchId: vi.fn(),
}));
vi.mock("@/neon_admin/neon_context", () => ({
  getConnectionUri: vi.fn(),
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
