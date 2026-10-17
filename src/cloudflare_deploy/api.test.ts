import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeTriggerSource,
  triggerDeploys,
  triggerDeploysBranch,
  getTriggerRootDirectory,
  CloudflareApiError,
  deleteTrigger,
  findBuildsForVersions,
  isCloudflareAuthFailure,
  listWorkerVersions,
  listWorkers,
  restoreTrigger,
  toCloudflareDyadError,
  verifyToken,
} from "./api";
import { ConnectCloudflareWorkerParamsSchema } from "@/ipc/types/cloudflare";

function respondWith(body: string, status = 200) {
  const fetchMock = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(body, { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ok = (result: unknown) => JSON.stringify({ success: true, result });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request paths", () => {
  it("cannot be redirected by a value that contains a path", async () => {
    const fetchMock = respondWith(ok([]));

    await listWorkers("token", "abc/../../user/tokens?x=1");

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    // Still the Workers list of one, oddly named, account.
    expect(url.pathname).toBe(
      "/client/v4/accounts/abc%2F..%2F..%2Fuser%2Ftokens%3Fx%3D1/workers/scripts",
    );
    expect(url.search).toBe("");
  });

  it("are not reachable with a malformed account id in the first place", () => {
    const params = {
      appId: 1,
      rootDirectory: "worker",
      workerName: "shop-api",
      mode: "create" as const,
    };
    expect(
      ConnectCloudflareWorkerParamsSchema.safeParse({
        ...params,
        accountId: "5d9c444101c1d77b1b7ff087beadc7e5",
      }).success,
    ).toBe(true);
    for (const accountId of ["", "../user", "abc/def", "not-an-id"]) {
      expect(
        ConnectCloudflareWorkerParamsSchema.safeParse({ ...params, accountId })
          .success,
      ).toBe(false);
    }
  });
});

describe("responses", () => {
  it("fail clearly when a success has no readable body", async () => {
    respondWith("<html>gateway</html>");
    await expect(verifyToken("token")).rejects.toThrow(/could not be read/);
  });

  it("accept a success with no body from a call that returns nothing", async () => {
    respondWith("", 200);
    await expect(
      deleteTrigger("token", "acct", "rule-1"),
    ).resolves.toBeUndefined();
  });

  it("refuse a success with no body from a call whose answer is used", async () => {
    respondWith("", 200);
    await expect(verifyToken("token")).rejects.toThrow(/could not be read/);
  });

  it("keep Cloudflare's status and codes on failure", async () => {
    respondWith(
      JSON.stringify({
        success: false,
        errors: [{ code: 10000, message: "Authentication error" }],
      }),
      403,
    );
    const error = await verifyToken("token").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudflareApiError);
    expect((error as CloudflareApiError).hasCode(10000)).toBe(true);
    expect(isCloudflareAuthFailure(error)).toBe(true);
  });

  it("do not count an outage as the token being refused", async () => {
    respondWith("", 503);
    const error = await verifyToken("token").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudflareApiError);
    expect(isCloudflareAuthFailure(error)).toBe(false);
  });

  it("keep the original error when reported as a DyadError", () => {
    // Its stack is what telemetry needs for an unexpected failure.
    const unexpected = new TypeError("fetch failed");
    expect(toCloudflareDyadError(unexpected, "Could not connect").cause).toBe(
      unexpected,
    );
    const refused = new CloudflareApiError("Forbidden", 403, []);
    expect(toCloudflareDyadError(refused, "Could not connect").cause).toBe(
      refused,
    );
  });
});

describe("what a rule deploys", () => {
  const rule = {
    trigger_uuid: "rule-1",
    branch_includes: ["staging"],
    repo_connection: { repo_name: "shop", provider_account_name: "acme" },
  };

  it("reads the folder in the form targets use", () => {
    expect(getTriggerRootDirectory({ ...rule, root_directory: "/" })).toBe("");
    expect(getTriggerRootDirectory({ ...rule, root_directory: "/api/" })).toBe(
      "api",
    );
    expect(getTriggerRootDirectory(rule)).toBe("");
  });

  it("names the repository, branch and folder", () => {
    expect(describeTriggerSource({ ...rule, root_directory: "/api" })).toBe(
      "acme/shop (branch staging, folder api)",
    );
    expect(describeTriggerSource({ ...rule, root_directory: "/" })).toBe(
      "acme/shop (branch staging, root folder)",
    );
  });
});

describe("whether a rule still deploys what the app syncs", () => {
  const rule = {
    trigger_uuid: "rule-1",
    branch_includes: ["main"],
    root_directory: "/api",
    repo_connection: { repo_name: "Shop", provider_account_name: "Acme" },
  };
  const app = {
    owner: "acme",
    repo: "shop",
    branch: "main",
    rootDirectory: "api",
  };

  it("does when repository, branch and folder match, whatever the case", () => {
    expect(triggerDeploys(rule, app)).toBe(true);
  });

  it("does not for another branch, folder or repository", () => {
    expect(triggerDeploys(rule, { ...app, branch: "redesign" })).toBe(false);
    expect(triggerDeploys(rule, { ...app, rootDirectory: "" })).toBe(false);
    expect(triggerDeploys(rule, { ...app, repo: "shop-v2" })).toBe(false);
    expect(triggerDeploys(rule, { ...app, owner: "someone" })).toBe(false);
  });

  it("does not hold a missing repository against the rule", () => {
    const { repo_connection: _, ...unnamed } = rule;
    expect(triggerDeploys(unnamed, { ...app, repo: "shop-v2" })).toBe(true);
    expect(triggerDeploys(rule, { ...app, owner: null, repo: null })).toBe(
      true,
    );
    expect(describeTriggerSource(unnamed)).toBe("branch main, folder api");
  });
});

describe("which branches set a rule off", () => {
  const rule = (includes: string[], excludes: string[] = []) => ({
    trigger_uuid: "rule-1",
    branch_includes: includes,
    branch_excludes: excludes,
  });

  it("is the branches it names", () => {
    expect(triggerDeploysBranch(rule(["main"]), "main")).toBe(true);
    expect(triggerDeploysBranch(rule(["main"]), "redesign")).toBe(false);
    expect(triggerDeploysBranch(rule(["main"]), "main-2")).toBe(false);
    expect(triggerDeploysBranch(rule(["main"]), "not-main")).toBe(false);
  });

  it("reads * as any run of characters", () => {
    expect(triggerDeploysBranch(rule(["*"]), "redesign")).toBe(true);
    expect(triggerDeploysBranch(rule(["release/*"]), "release/1.2")).toBe(true);
    expect(triggerDeploysBranch(rule(["release/*"]), "main")).toBe(false);
  });

  it("lets an exclusion win", () => {
    expect(triggerDeploysBranch(rule(["*"], ["main"]), "main")).toBe(false);
    expect(triggerDeploysBranch(rule(["*"], ["main"]), "redesign")).toBe(true);
  });

  it("takes every other character in a pattern literally", () => {
    expect(triggerDeploysBranch(rule(["feat.x"]), "feat.x")).toBe(true);
    expect(triggerDeploysBranch(rule(["feat.x"]), "featax")).toBe(false);
    expect(triggerDeploysBranch(rule(["fix(ui)"]), "fix(ui)")).toBe(true);
  });
});

describe("restoreTrigger", () => {
  it("sends back what Cloudflare listed, and nothing it did not", async () => {
    const fetchMock = respondWith(ok({}));

    // The shape Cloudflare lists a rule in.
    await restoreTrigger("token", "acct", {
      trigger_uuid: "rule-1",
      trigger_name: "Deploy production",
      build_token_uuid: "build-token-1",
      build_command: "",
      deploy_command: "npx wrangler deploy",
      root_directory: "/",
      branch_includes: ["main"],
      branch_excludes: [],
      path_includes: ["*"],
      repo_connection: { repo_connection_uuid: "conn-1", repo_name: "shop" },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("PATCH");
    expect(String(url)).toMatch(/\/accounts\/acct\/builds\/triggers\/rule-1$/);
    expect(JSON.parse(String(init?.body))).toEqual({
      repo_connection_uuid: "conn-1",
      build_token_uuid: "build-token-1",
      trigger_name: "Deploy production",
      // An empty build command is a real value, not a missing one.
      build_command: "",
      deploy_command: "npx wrangler deploy",
      root_directory: "/",
      branch_includes: ["main"],
      branch_excludes: [],
      path_includes: ["*"],
    });
  });
});

describe("matching versions to builds", () => {
  it("asks about at most 20 versions per request and merges the answers", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const ids = new URL(String(input)).searchParams
        .get("version_ids")!
        .split(",");
      return new Response(
        ok({ builds: { [ids[0]]: { build_uuid: `build-for-${ids[0]}` } } }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const ids = Array.from({ length: 25 }, (_, i) => `v-${i}`);

    const builds = await findBuildsForVersions("token", "acct", ids);

    const sent = fetchMock.mock.calls.map(
      (call) =>
        new URL(String(call[0])).searchParams.get("version_ids")!.split(",")
          .length,
    );
    expect(sent).toEqual([20, 5]);
    expect(builds["v-0"]?.build_uuid).toBe("build-for-v-0");
    expect(builds["v-20"]?.build_uuid).toBe("build-for-v-20");
  });

  it("sends nothing for no versions", async () => {
    const fetchMock = respondWith(ok({ builds: {} }));
    expect(await findBuildsForVersions("token", "acct", [])).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads when each version was made and whether it has an address of its own", async () => {
    const fetchMock = respondWith(
      ok({
        items: [
          {
            id: "v-1",
            metadata: { created_on: "2026-01-01T00:00:00Z", has_preview: true },
          },
          { id: "v-2", metadata: { has_preview: false } },
          { id: "v-3" },
        ],
      }),
    );

    expect(
      await listWorkerVersions("token", "acct", "shop-api", {
        page: 2,
        perPage: 20,
      }),
    ).toEqual([
      { id: "v-1", createdOn: "2026-01-01T00:00:00Z", hasPreview: true },
      { id: "v-2", createdOn: null, hasPreview: false },
      { id: "v-3", createdOn: null, hasPreview: false },
    ]);
    expect(new URL(String(fetchMock.mock.calls[0][0])).search).toBe(
      "?page=2&per_page=20",
    );
  });
});
