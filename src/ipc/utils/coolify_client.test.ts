import { afterEach, describe, expect, it, vi } from "vitest";
import { CoolifyClient, isCoolifyStatus } from "./coolify_client";
import { isSecureInstanceUrl } from "../types/coolify";
import { DyadErrorKind } from "@/errors/dyad_error";

function mockFetch(
  responses: Array<{ status: number; body?: string }>,
): ReturnType<typeof vi.fn> {
  const calls = responses.slice();
  const fn = vi.fn(async () => {
    const next = calls.shift() ?? { status: 200, body: "[]" };
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => next.body ?? "",
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function client() {
  return new CoolifyClient({
    instanceUrl: "https://coolify.example.com",
    token: "1|abc",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("error classification", () => {
  it("names the API switch when the instance has it disabled", async () => {
    mockFetch([
      { status: 403, body: '{"success":true,"message":"API is disabled."}' },
    ]);
    await expect(client().listServers()).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
      message: expect.stringContaining("Settings → Advanced"),
    });
  });

  it("reports a permission problem separately from the API switch", async () => {
    mockFetch([{ status: 403, body: '{"message":"Forbidden"}' }]);
    await expect(client().listServers()).rejects.toMatchObject({
      message: expect.stringContaining("lack of permissions"),
    });
  });

  it("carries the status so callers can branch on it", async () => {
    mockFetch([{ status: 404, body: "" }]);
    const error = await client()
      .getApplication("missing")
      .catch((e) => e);
    expect(isCoolifyStatus(error, 404)).toBe(true);
    expect(isCoolifyStatus(error, 409)).toBe(false);
  });
});

describe("setEnv", () => {
  it("updates only when the variable already exists", async () => {
    const fetchMock = mockFetch([
      { status: 409, body: '{"message":"already exists"}' },
      { status: 200, body: "{}" },
    ]);
    await client().setEnv("app-1", "DATABASE_URL", "postgres://x");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].method).toBe("PATCH");
  });

  it("does not retry as an update after an unrelated failure", async () => {
    // A PATCH here could overwrite a value after an ambiguous create.
    const fetchMock = mockFetch([{ status: 500, body: "boom" }]);
    await expect(
      client().setEnv("app-1", "DATABASE_URL", "postgres://x"),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("registerPrivateKey", () => {
  it("reuses an existing key with the same name", async () => {
    const fetchMock = mockFetch([
      { status: 200, body: '[{"uuid":"k1","name":"dyad_deploy_o_r","id":7}]' },
    ]);
    const result = await client().registerPrivateKey({
      name: "dyad_deploy_o_r",
      privateKey: "PRIVATE",
    });
    expect(result).toEqual({ uuid: "k1", id: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates a failed lookup rather than creating a duplicate", async () => {
    const fetchMock = mockFetch([{ status: 500, body: "unavailable" }]);
    await expect(
      client().registerPrivateKey({ name: "k", privateKey: "PRIVATE" }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("createApplicationFromPrivateRepo", () => {
  it("asks Coolify to generate an address only when no domain is given", async () => {
    const fetchMock = mockFetch([{ status: 200, body: '{"uuid":"app-1"}' }]);
    await client().createApplicationFromPrivateRepo({
      serverUuid: "s",
      projectUuid: "p",
      environmentName: "production",
      privateKeyUuid: "k",
      gitRepository: "git@github.com:o/r.git",
      gitBranch: "main",
      name: "dyad-app",
      build: {
        buildPack: "railpack",
        portsExposes: "80",
        isStatic: true,
        isSpa: true,
        publishDirectory: "/dist",
      },
      domains: "app.example.com",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      build_pack: "railpack",
      ports_exposes: "80",
      is_static: true,
      is_spa: true,
      publish_directory: "/dist",
      domains: "app.example.com",
      autogenerate_domain: false,
    });
  });
});

describe("isSecureInstanceUrl", () => {
  it("treats https as secure", () => {
    expect(isSecureInstanceUrl("https://coolify.example.com")).toBe(true);
  });

  it("treats plain http as insecure, since the token is readable in transit", () => {
    // Still allowed, but only with an explicit acknowledgement — a stock
    // Coolify serves http until it has a domain and certificate.
    expect(isSecureInstanceUrl("http://coolify.example.com:8000")).toBe(false);
  });

  it("treats loopback over http as secure since it never leaves the machine", () => {
    expect(isSecureInstanceUrl("http://localhost:8000")).toBe(true);
    expect(isSecureInstanceUrl("http://127.0.0.1:8000")).toBe(true);
  });

  it("rejects nonsense", () => {
    expect(isSecureInstanceUrl("not a url")).toBe(false);
  });
});

describe("auth failures are classified as Auth", () => {
  it("treats a rejected token as an auth failure, not bad input", async () => {
    // rules/dyad-errors.md: Auth is "not signed in, missing token"; Validation
    // is for malformed input. A revoked token is the former.
    mockFetch([{ status: 401, body: "" }]);
    await expect(client().listServers()).rejects.toMatchObject({
      kind: DyadErrorKind.Auth,
    });
  });

  it("treats missing scopes as an auth failure", async () => {
    mockFetch([{ status: 403, body: '{"message":"Forbidden"}' }]);
    await expect(client().listServers()).rejects.toMatchObject({
      kind: DyadErrorKind.Auth,
    });
  });

  it("keeps the disabled-API case a precondition, which the user fixes elsewhere", async () => {
    mockFetch([
      { status: 403, body: '{"success":true,"message":"API is disabled."}' },
    ]);
    await expect(client().listServers()).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
    });
  });
});
