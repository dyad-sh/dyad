import { describe, expect, it, vi, beforeEach } from "vitest";
import { CoolifyClient, resolveServerSshHost } from "./coolify_client";

const client = new CoolifyClient({
  instanceUrl: "http://coolify.test:8000/",
  token: "tok",
});

function respond(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () =>
      Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  } as Response);
}

describe("CoolifyClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("strips a trailing slash and calls the versioned API path", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => respond(200, []));
    await client.listServers();
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "http://coolify.test:8000/api/v1/servers",
    );
  });

  it("sends the bearer token", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => respond(200, []));
    await client.listServers();
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
  });

  it("never sends cookies, which a proxy would reject as oversized headers", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => respond(200, []));
    await client.listServers();
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("omit");
  });

  it("reports the token length when a proxy rejects oversized headers", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      respond(
        400,
        "<html><title>400 Request Header Or Cookie Too Large</title>",
      ),
    );
    const fat = new CoolifyClient({
      instanceUrl: "http://coolify.test:8000",
      token: "x".repeat(2000),
    });
    await expect(fat.listServers()).rejects.toThrow(
      /2000 characters, which is far longer/,
    );
  });

  it("points elsewhere when headers are oversized but the token is normal", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      respond(
        400,
        "<html><title>400 Request Header Or Cookie Too Large</title>",
      ),
    );
    await expect(client.listServers()).rejects.toThrow(/enlarged elsewhere/);
  });

  it("puts the application on the network where the database lives", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => respond(201, { uuid: "app-1" }));
    await client.createApplicationFromPrivateRepo({
      serverUuid: "s",
      projectUuid: "p",
      environmentName: "production",
      privateKeyUuid: "k",
      gitRepository: "git@github.com:o/r.git",
      gitBranch: "main",
      name: "app",
      portsExposes: "3000",
    });
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    // Without this the app cannot resolve the database's container hostname.
    expect(body.connect_to_docker_network).toBe(true);
  });

  it("explains which scopes are missing on 403", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      respond(403, { message: "Missing required permissions: write" }),
    );
    await expect(client.listProjects()).rejects.toThrow(
      /read:sensitive.*write.*deploy|needs all of/s,
    );
  });

  it("reports a bad token distinctly from a scope problem on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      respond(401, { message: "Unauthenticated" }),
    );
    await expect(client.listProjects()).rejects.toThrow(
      /rejected the API token/i,
    );
  });

  it("reports an unreachable instance rather than a generic failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(client.listServers()).rejects.toThrow(
      /Could not reach Coolify/,
    );
  });

  it("creates databases without exposing them publicly", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => respond(201, { uuid: "db-1" }));
    await client.createPostgres({
      serverUuid: "s",
      projectUuid: "p",
      environmentName: "production",
      name: "db",
    });
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.is_public).toBe(false);
    expect(body.public_port).toBeUndefined();
  });

  it("falls back to PATCH when an env var already exists", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const method = (init as RequestInit).method!;
      calls.push(method);
      if (method === "POST") {
        return respond(409, { message: "Environment variable already exists" });
      }
      return respond(200, {});
    });
    await client.setEnv("app-1", "DATABASE_URL", "postgres://x");
    expect(calls).toEqual(["POST", "PATCH"]);
  });

  it("marks env values literal so a $ in a password is not interpolated", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => respond(200, {}));
    await client.setEnv("app-1", "DATABASE_URL", "postgres://u:p$w@h/db");
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.is_literal).toBe(true);
    // There is no is_build_time field; sending one fails validation.
    expect(body.is_build_time).toBeUndefined();
  });

  it("reuses an existing private key instead of registering a duplicate", async () => {
    const methods: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const method = (init as RequestInit).method!;
      methods.push(method);
      if (method === "GET") {
        return respond(200, [{ uuid: "key-1", name: "dyad-deploy" }]);
      }
      return respond(201, { uuid: "key-new" });
    });
    const result = await client.registerPrivateKey({
      name: "dyad-deploy",
      privateKey: "PEM",
    });
    expect(result.uuid).toBe("key-1");
    expect(methods).not.toContain("POST");
  });

  it("reads deployment status from the deployment endpoint", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => respond(200, { status: "finished" }));
    const result = await client.getDeployment("dep-1");
    expect(fetchSpy.mock.calls[0][0]).toContain("/deployments/dep-1");
    // Guards against regressing to /deployments/applications/{uuid}, which
    // returns Application objects with no status.
    expect(fetchSpy.mock.calls[0][0]).not.toContain(
      "/deployments/applications",
    );
    expect(result.status).toBe("finished");
  });
});

describe("resolveServerSshHost", () => {
  const instanceUrl = "http://203.0.113.7:8000";

  it.each([
    "host.docker.internal",
    "localhost",
    "127.0.0.1",
    "::1",
    "172.17.0.1",
  ])(
    "substitutes the instance host for %s, which only Coolify can reach",
    (serverIp) => {
      expect(resolveServerSshHost({ serverIp, instanceUrl })).toBe(
        "203.0.113.7",
      );
    },
  );

  it("keeps a genuinely remote address", () => {
    expect(
      resolveServerSshHost({ serverIp: "198.51.100.9", instanceUrl }),
    ).toBe("198.51.100.9");
  });

  it("falls back to the instance host when no address is recorded", () => {
    expect(resolveServerSshHost({ serverIp: null, instanceUrl })).toBe(
      "203.0.113.7",
    );
  });

  it("handles a hostname-based instance URL", () => {
    expect(
      resolveServerSshHost({
        serverIp: "localhost",
        instanceUrl: "https://coolify.example.com",
      }),
    ).toBe("coolify.example.com");
  });

  it("returns null rather than a bad guess when the URL is unusable", () => {
    expect(
      resolveServerSshHost({ serverIp: "localhost", instanceUrl: "not-a-url" }),
    ).toBeNull();
  });
});
