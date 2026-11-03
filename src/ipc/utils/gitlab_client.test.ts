import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { warn, netFetch } = vi.hoisted(() => ({
  warn: vi.fn(),
  netFetch: vi.fn(),
}));

vi.mock("electron", () => ({ net: { fetch: netFetch } }));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      info: vi.fn(),
      warn,
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { net } from "electron";
import {
  GitLabClient,
  describeGitLabError,
  encodeProjectRef,
  isGitLabStatus,
} from "./gitlab_client";

type Route = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

const calls: Array<{ url: string; init: RequestInit }> = [];
let routes: Record<string, Route | Route[]> = {};

function respond(url: string, init: RequestInit): Response {
  calls.push({ url, init });
  const key = `${init.method ?? "GET"} ${url}`;
  // A prefix match on the whole "METHOD URL", so only the query string may
  // differ. `includes` let `POST /projects/wrong` match the create-project
  // route, and an unmatched request used to become the same 404 one test
  // asserts on — between them a wrong URL could pass the suite.
  const match = Object.entries(routes).find(([pattern]) =>
    key.startsWith(pattern),
  );
  if (!match) {
    throw new Error(`No route registered for ${key}`);
  }
  const value = match[1];
  const route = Array.isArray(value) ? (value.shift() ?? value[0]) : value;
  return new Response(
    typeof route.body === "string" ? route.body : JSON.stringify(route.body),
    { status: route.status, headers: route.headers },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  routes = {};
  netFetch
    .mockReset()
    .mockImplementation(async (url: string, init: RequestInit) =>
      respond(url, init),
    );
  // A separate spy proves GitLab does not fall back to Node's networking stack.
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const client = () =>
  new GitLabClient({
    instanceUrl: "https://gitlab.example.com/",
    token: "glpat-secret",
  });

describe("GitLabClient requests", () => {
  it("passes caller cancellation to the in-flight Chromium request", async () => {
    const controller = new AbortController();
    netFetch.mockImplementation(
      (_url: string, { signal }: RequestInit) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener("abort", () => reject(signal!.reason), {
            once: true,
          });
        }),
    );
    const request = new GitLabClient({
      instanceUrl: "https://gitlab.example.com",
      token: "secret",
      signal: controller.signal,
    }).getCurrentUser();
    controller.abort();
    await expect(request).rejects.toMatchObject({
      kind: DyadErrorKind.UserCancelled,
    });
    expect(netFetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("passes the 30-second timeout signal to Chromium even with a caller signal", async () => {
    const timeout = new AbortController();
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeout.signal);
    try {
      netFetch.mockImplementation(
        (_url: string, { signal }: RequestInit) =>
          new Promise((_resolve, reject) => {
            signal!.addEventListener("abort", () => reject(signal!.reason), {
              once: true,
            });
          }),
      );
      const request = new GitLabClient({
        instanceUrl: "https://gitlab.example.com",
        token: "secret",
        signal: new AbortController().signal,
      }).getCurrentUser();
      timeout.abort(new DOMException("timed out", "TimeoutError"));
      await expect(request).rejects.toMatchObject({
        kind: DyadErrorKind.External,
        message: expect.stringContaining("no response within 30s"),
      });
      expect(timeoutSpy).toHaveBeenCalledExactlyOnceWith(30_000);
      expect(netFetch.mock.calls[0][1].signal.aborted).toBe(true);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("logs and surfaces the nested TLS cause and code without request credentials", async () => {
    const cause = Object.assign(
      new Error("unable to verify the first certificate"),
      {
        code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      },
    );
    vi.mocked(net.fetch).mockRejectedValue(
      new TypeError("fetch failed", { cause }),
    );

    const error = await client()
      .getCurrentUser()
      .catch((err) => err);
    expect(error).toMatchObject({
      name: "GitLabTransportError",
      kind: DyadErrorKind.External,
      message:
        "Could not reach GitLab at https://gitlab.example.com: fetch failed; caused by: UNABLE_TO_VERIFY_LEAF_SIGNATURE: unable to verify the first certificate",
    });
    expect(warn).toHaveBeenCalledExactlyOnceWith(error.message);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("glpat-secret");
  });

  it("includes individual failures inside an aggregate connection error", async () => {
    const attempts = ["ECONNREFUSED", "ENETUNREACH"].map((code) =>
      Object.assign(new Error("connect failed"), { code }),
    );
    vi.mocked(net.fetch).mockRejectedValue(
      new TypeError("fetch failed", {
        cause: new AggregateError(attempts),
      }),
    );

    await expect(client().getCurrentUser()).rejects.toMatchObject({
      message: expect.stringContaining(
        "ECONNREFUSED: connect failed; caused by: ENETUNREACH: connect failed",
      ),
    });
  });

  it("handles plain-object and string causes, redacts tokens and flattens log lines", async () => {
    vi.mocked(net.fetch).mockRejectedValue(
      new TypeError("fetch failed", {
        cause: {
          code: "ENOTFOUND",
          message: "lookup\nfailed glpat-secret",
          cause: "DNS unavailable",
        },
      }),
    );
    const error = await client()
      .getCurrentUser()
      .catch((err) => err);
    expect(error.message).toContain(
      "ENOTFOUND: lookup failed [redacted]; caused by: DNS unavailable",
    );
    expect(warn).toHaveBeenCalledExactlyOnceWith(error.message);
    expect(error.message).not.toContain("glpat-secret");
    expect(error.message).not.toContain("\n");
  });

  it("bounds long diagnostics and stops cyclic causes", async () => {
    const cyclic = new Error("socket failure");
    cyclic.cause = cyclic;
    vi.mocked(net.fetch).mockRejectedValueOnce(
      new TypeError("fetch failed", { cause: cyclic }),
    );
    await expect(client().getCurrentUser()).rejects.toMatchObject({
      message: expect.stringContaining(
        "fetch failed; caused by: socket failure",
      ),
    });
    vi.mocked(net.fetch).mockRejectedValueOnce(
      new TypeError("fetch failed", {
        cause: new Error("x".repeat(10_000) + "glpat-secret"),
      }),
    );
    const error = await client()
      .getCurrentUser()
      .catch((err) => err);
    expect(error.message.length).toBeLessThan(600);
    expect(error.message).toContain("…");
  });

  it("logs response-body transport failures too", async () => {
    vi.mocked(net.fetch).mockResolvedValue({
      text: async () => {
        throw new TypeError("terminated", { cause: { code: "ECONNRESET" } });
      },
    } as unknown as Response);
    const error = await client()
      .getCurrentUser()
      .catch((err) => err);
    expect(error.message).toContain("terminated; caused by: ECONNRESET");
    expect(warn).toHaveBeenCalledExactlyOnceWith(error.message);
  });

  it("keeps timeout guidance and does not log user cancellation as a network failure", async () => {
    vi.mocked(net.fetch).mockRejectedValue(
      new DOMException("timed out", "TimeoutError"),
    );
    await expect(client().getCurrentUser()).rejects.toMatchObject({
      message: expect.stringContaining("no response within 30s"),
    });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockClear();
    const controller = new AbortController();
    controller.abort();
    await expect(
      new GitLabClient({
        instanceUrl: "https://gitlab.example.com",
        token: "secret",
        signal: controller.signal,
      }).getCurrentUser(),
    ).rejects.toMatchObject({ kind: DyadErrorKind.UserCancelled });
    expect(warn).not.toHaveBeenCalled();
  });

  it("builds URLs from the instance address and sends the token header", async () => {
    routes["GET https://gitlab.example.com/api/v4/user"] = {
      status: 200,
      body: { id: 7, username: "rene", name: "René", namespace_id: 42 },
    };

    const user = await client().getCurrentUser();

    expect(user).toEqual({
      id: 7,
      username: "rene",
      name: "René",
      email: null,
      namespaceId: 42,
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["PRIVATE-TOKEN"]).toBe("glpat-secret");
    expect(calls[0].init.credentials).toBe("omit");
    expect(net.fetch).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps a relative URL root in the API path", async () => {
    routes["GET https://host.example/gitlab/api/v4/user"] = {
      status: 200,
      body: { id: 1, username: "u" },
    };
    const user = await new GitLabClient({
      instanceUrl: "https://host.example/gitlab",
      token: "t",
    }).getCurrentUser();
    expect(user.username).toBe("u");
  });

  it("maps 401 to an Auth error that says to reconnect", async () => {
    routes["GET https://gitlab.example.com/api/v4/user"] = {
      status: 401,
      body: { message: "401 Unauthorized" },
    };

    await expect(client().getCurrentUser()).rejects.toMatchObject({
      kind: DyadErrorKind.Auth,
      message: expect.stringContaining("reconnect GitLab"),
    });
  });

  it("maps 404 to NotFound and exposes the status", async () => {
    routes["GET https://gitlab.example.com/api/v4/projects/group%2Fapp"] = {
      status: 404,
      body: { message: "404 Project Not Found" },
    };

    const error = await client()
      .getProject("group/app")
      .catch((err) => err);
    expect(isDyadError(error)).toBe(true);
    expect(error.kind).toBe(DyadErrorKind.NotFound);
    expect(isGitLabStatus(error, 404)).toBe(true);
    expect(isGitLabStatus(error, 400)).toBe(false);
  });

  it("flattens GitLab's field-keyed validation errors", async () => {
    routes["POST https://gitlab.example.com/api/v4/projects"] = {
      status: 400,
      body: { message: { path: ["has already been taken"] } },
    };

    await expect(
      client().createProject({ name: "app", path: "app", namespaceId: 1 }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message: expect.stringContaining("path has already been taken"),
    });
  });

  it("reports a non-JSON answer as not being a GitLab instance", async () => {
    routes["GET https://gitlab.example.com/api/v4/user"] = {
      status: 200,
      body: "<html>login</html>",
    };

    await expect(client().getCurrentUser()).rejects.toMatchObject({
      kind: DyadErrorKind.External,
      message: expect.stringContaining("not JSON"),
    });
  });

  it("returns null token info on an instance too old to report it", async () => {
    routes[
      "GET https://gitlab.example.com/api/v4/personal_access_tokens/self"
    ] = { status: 404, body: { message: "404 Not Found" } };

    expect(await client().getTokenInfo()).toBeNull();
  });

  it("follows pagination headers when listing", async () => {
    routes["GET https://gitlab.example.com/api/v4/groups"] = [
      {
        status: 200,
        body: [{ id: 1, full_path: "a", name: "A" }],
        headers: { "x-next-page": "2" },
      },
      {
        status: 200,
        body: [{ id: 2, full_path: "a/b", name: "B" }],
        headers: { "x-next-page": "" },
      },
    ];

    const groups = await client().listGroups();

    expect(groups.map((g) => g.fullPath)).toEqual(["a", "a/b"]);
    expect(calls.map((c) => c.url)).toEqual([
      expect.stringContaining("min_access_level=30"),
      expect.stringContaining("page=2"),
    ]);
    expect(groups[0].kind).toBe("group");
  });

  it("creates private projects without a README so the first push owns main", async () => {
    routes["POST https://gitlab.example.com/api/v4/projects"] = {
      status: 201,
      body: {
        id: 9,
        name: "My App",
        path: "my-app",
        path_with_namespace: "group/my-app",
        ssh_url_to_repo: "git@gitlab.example.com:group/my-app.git",
        http_url_to_repo: "https://gitlab.example.com/group/my-app.git",
        web_url: "https://gitlab.example.com/group/my-app",
      },
    };

    const project = await client().createProject({
      name: "My App",
      path: "my-app",
      namespaceId: 3,
    });

    expect(project.pathWithNamespace).toBe("group/my-app");
    expect(project.defaultBranch).toBeNull();
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      name: "My App",
      path: "my-app",
      namespace_id: 3,
      visibility: "private",
      initialize_with_readme: false,
    });
  });

  it("adds deploy keys read-only", async () => {
    routes["POST https://gitlab.example.com/api/v4/projects/9/deploy_keys"] = {
      status: 201,
      body: { id: 5, title: "Dyad", key: "ssh-ed25519 AAAA", can_push: false },
    };

    const key = await client().addDeployKey(9, {
      title: "Dyad",
      key: "ssh-ed25519 AAAA",
    });

    expect(key).toEqual({
      id: 5,
      title: "Dyad",
      key: "ssh-ed25519 AAAA",
      canPush: false,
    });
    expect(JSON.parse(calls[0].init.body as string).can_push).toBe(false);
  });
});

describe("describeGitLabError", () => {
  it("prefers message, then error, then the status", () => {
    expect(describeGitLabError('{"message":"nope"}', 400)).toBe("nope");
    expect(describeGitLabError('{"error":"bad"}', 400)).toBe("bad");
    expect(describeGitLabError("{}", 500)).toBe("HTTP 500");
    expect(describeGitLabError("plain text", 502)).toBe("plain text");
    expect(describeGitLabError("", 503)).toBe("HTTP 503");
  });
});

describe("encodeProjectRef", () => {
  it("passes ids through and URL-encodes paths", () => {
    expect(encodeProjectRef(12)).toBe("12");
    expect(encodeProjectRef("group/sub/app")).toBe("group%2Fsub%2Fapp");
  });
});
