import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CloudflareApiError,
  deleteTrigger,
  isCloudflareAuthFailure,
  listWorkers,
  restoreTrigger,
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

  it("accept a success that has no body at all", async () => {
    respondWith("", 200);
    await expect(
      deleteTrigger("token", "acct", "rule-1"),
    ).resolves.toBeUndefined();
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
