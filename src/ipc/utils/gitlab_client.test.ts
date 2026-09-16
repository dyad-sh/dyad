import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { DyadErrorKind, isDyadError } from "@/errors/dyad_error";
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
  const match = Object.entries(routes).find(([pattern]) =>
    key.includes(pattern),
  );
  if (!match) {
    return new Response(JSON.stringify({ message: "404 Not Found" }), {
      status: 404,
    });
  }
  const value = match[1];
  const route = Array.isArray(value) ? (value.shift() ?? value[0]) : value;
  return new Response(
    typeof route.body === "string" ? route.body : JSON.stringify(route.body),
    { status: route.status, headers: route.headers },
  );
}

beforeEach(() => {
  calls.length = 0;
  routes = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => respond(url, init)),
  );
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
