import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({})),
  writeSettings: vi.fn(),
}));
vi.mock("@/ipc/utils/query_invalidation_delivery", () => ({
  publishQueryInvalidations: vi.fn(),
}));
vi.mock("@/ipc/utils/telemetry", () => ({ sendTelemetryEvent: vi.fn() }));
const { neonApi } = vi.hoisted(() => ({
  neonApi: {
    status: 500,
    /** Statuses for specific access tokens, overriding `status`. */
    statusByToken: {} as Record<string, number>,
    requestTokens: [] as string[],
    onRequest: undefined as (() => void) | undefined,
  },
}));
vi.mock("@neondatabase/api-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@neondatabase/api-client")>();
  return {
    ...actual,
    // Real axios clients, including Dyad's interceptors, over a fake transport
    // that answers each request with the status the test chooses.
    createApiClient: (config: Parameters<typeof actual.createApiClient>[0]) =>
      actual.createApiClient({
        ...config,
        adapter: async (request) => {
          neonApi.onRequest?.();
          const token = String(request.headers.Authorization).replace(
            /^Bearer /,
            "",
          );
          neonApi.requestTokens.push(token);
          const status = neonApi.statusByToken[token] ?? neonApi.status;
          if (status < 300) {
            return {
              data: { token },
              status,
              statusText: "OK",
              headers: {},
              config: request,
            };
          }
          throw Object.assign(
            new Error(`Request failed with status code ${status}`),
            {
              config: request,
              response: { status, data: {}, headers: {} },
            },
          );
        },
      }),
  };
});

import { readSettings, writeSettings } from "@/main/settings";
import {
  createNeonApiClient,
  getNeonClient,
  getNeonOrganizationId,
  refreshNeonToken,
} from "./neon_management_client";
import { handleNeonOAuthReturn } from "./neon_return_handler";
import { DyadErrorKind } from "@/errors/dyad_error";
import { publishQueryInvalidations } from "@/ipc/utils/query_invalidation_delivery";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";
import { NEON_RECONNECT_REQUIRED_MESSAGE } from "@/shared/neon_auth";

let settings: ReturnType<typeof readSettings>;
beforeEach(() => {
  vi.clearAllMocks();
  settings = {
    neon: {
      accessToken: { value: "expired-access" },
      refreshToken: { value: "old-refresh" },
      expiresIn: 1,
      tokenTimestamp: 0,
    },
  } as ReturnType<typeof readSettings>;
  vi.mocked(readSettings).mockImplementation(() => structuredClone(settings));
  vi.mocked(writeSettings).mockImplementation((update) => {
    settings = { ...settings, ...structuredClone(update) };
  });
});

describe("refreshNeonToken", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shares one refresh request across concurrent callers", async () => {
    vi.mocked(readSettings).mockReturnValue({
      neon: {
        refreshToken: { value: "rotating-refresh-token" },
        expiresIn: 1,
        tokenTimestamp: 0,
      },
    } as ReturnType<typeof readSettings>);
    let release: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );

    const first = refreshNeonToken();
    const second = refreshNeonToken();
    expect(second).toBe(first);
    expect(fetch).toHaveBeenCalledOnce();

    release(
      new Response(
        JSON.stringify({
          accessToken: "access",
          refreshToken: "rotated",
          expiresIn: 3600,
        }),
        { status: 200 },
      ),
    );
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it("stops queued and future refreshes after invalid_grant and recovers after OAuth", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "Failed to refresh tokens",
              details: {
                error: "invalid_grant",
                error_description: "private token details",
              },
            }),
            { status: 400, statusText: "Bad Request" },
          ),
      ),
    );
    const results = await Promise.allSettled([
      getNeonClient(),
      getNeonClient(),
      getNeonClient(),
    ]);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected")
        expect(result.reason).toMatchObject({ kind: DyadErrorKind.Auth });
    }
    await expect(getNeonClient()).rejects.toMatchObject({
      kind: DyadErrorKind.Auth,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(settings.neon?.reconnectRequired).toBe(true);
    expect(publishQueryInvalidations).toHaveBeenCalledExactlyOnceWith([
      { family: "provider-status", provider: "neon" },
    ]);
    expect(sendTelemetryEvent).toHaveBeenCalledExactlyOnceWith(
      "neon:reconnect-required",
      { reason: "invalid_grant" },
    );

    handleNeonOAuthReturn({
      token: "new-access",
      refreshToken: "new-refresh",
      expiresIn: 3600,
    });
    await expect(getNeonClient()).resolves.toBeDefined();
    expect(settings.neon?.reconnectRequired).toBeUndefined();
    expect(settings.neon?.accessToken?.value).toBe("new-access");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    [400, { error: "invalid_client" }],
    [400, { error: "unknown-sensitive-error" }],
    [500, { error: "invalid_grant" }],
    [503, { error: "temporarily_unavailable" }],
  ])(
    "keeps credentials and allows retry for HTTP %s / %j",
    async (status, body) => {
      const original = structuredClone(settings);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(body), { status })),
      );
      await expect(refreshNeonToken()).rejects.toMatchObject({
        kind: DyadErrorKind.External,
      });
      await expect(refreshNeonToken()).rejects.toMatchObject({
        kind: DyadErrorKind.External,
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(settings).toEqual(original);
      expect(sendTelemetryEvent).not.toHaveBeenCalled();
    },
  );

  it("retains credentials after a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    await expect(refreshNeonToken()).rejects.toThrow("fetch failed");
    expect(settings.neon?.reconnectRequired).toBeUndefined();
    expect(writeSettings).not.toHaveBeenCalled();
  });

  it("requires sign-in if the expired session has no refresh token", async () => {
    delete settings.neon!.refreshToken;
    vi.stubGlobal("fetch", vi.fn());
    await expect(refreshNeonToken()).rejects.toMatchObject({
      kind: DyadErrorKind.Auth,
    });
    expect(settings.neon?.reconnectRequired).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["success", "invalid_grant", "network"])(
    "ignores an old refresh %s after a new sign-in",
    async (outcome) => {
      let finish!: (value: Response) => void;
      let fail!: (reason: Error) => void;
      vi.stubGlobal(
        "fetch",
        vi.fn(
          () =>
            new Promise<Response>((resolve, reject) => {
              finish = resolve;
              fail = reject;
            }),
        ),
      );
      const refresh = refreshNeonToken();
      handleNeonOAuthReturn({
        token: "new-access",
        refreshToken: "new-refresh",
        expiresIn: 3600,
      });
      if (outcome === "network") fail(new TypeError("fetch failed"));
      else
        finish(
          new Response(
            JSON.stringify(
              outcome === "success"
                ? {
                    accessToken: "obsolete-access",
                    refreshToken: "obsolete-refresh",
                    expiresIn: 3600,
                  }
                : { error: "invalid_grant" },
            ),
            { status: outcome === "success" ? 200 : 400 },
          ),
        );
      await expect(refresh).resolves.toBeUndefined();
      expect(settings.neon?.accessToken?.value).toBe("new-access");
      expect(settings.neon?.reconnectRequired).toBeUndefined();
      expect(sendTelemetryEvent).not.toHaveBeenCalled();
    },
  );

  it("does not restore credentials after disconnect during refresh", async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const refresh = refreshNeonToken();
    writeSettings({ neon: undefined });
    finish(
      new Response(
        JSON.stringify({
          accessToken: "obsolete",
          refreshToken: "obsolete",
          expiresIn: 3600,
        }),
      ),
    );
    await refresh;
    expect(settings.neon).toBeUndefined();
  });

  it("preserves the refresh token when a successful response does not rotate it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ accessToken: "fresh", expiresIn: 3600 }),
          ),
      ),
    );
    await refreshNeonToken();
    expect(settings.neon?.refreshToken?.value).toBe("old-refresh");
    expect(settings.neon?.accessToken?.value).toBe("fresh");
  });

  it("rejects malformed successful responses without overwriting credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ accessToken: "fresh" }))),
    );
    await expect(refreshNeonToken()).rejects.toMatchObject({
      kind: DyadErrorKind.External,
    });
    expect(writeSettings).not.toHaveBeenCalled();
  });

  it.each(["null", "<html>private credential details</html>"])(
    "reports invalid success payloads safely: %s",
    async (body) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(body)),
      );
      await expect(refreshNeonToken()).rejects.toMatchObject({
        kind: DyadErrorKind.External,
        message:
          "Neon token refresh returned an invalid response. Please try again.",
      });
      expect(writeSettings).not.toHaveBeenCalled();
    },
  );
});

describe("Neon API rejection of an unexpired access token", () => {
  const reconnectError = {
    kind: DyadErrorKind.Auth,
    message: NEON_RECONNECT_REQUIRED_MESSAGE,
  };

  beforeEach(() => {
    neonApi.status = 401;
    neonApi.statusByToken = {};
    neonApi.requestTokens = [];
    neonApi.onRequest = undefined;
    settings = {
      neon: {
        accessToken: { value: "revoked-access" },
        refreshToken: { value: "old-refresh" },
        expiresIn: 3600,
        tokenTimestamp: Math.floor(Date.now() / 1000),
      },
    } as ReturnType<typeof readSettings>;
  });

  it("requires reconnection once for concurrent rejected requests", async () => {
    const client = await getNeonClient();
    const results = await Promise.allSettled([
      client.getProject("project-1"),
      client.listProjects({}),
    ]);

    for (const result of results) {
      expect(result.status).toBe("rejected");
      expect((result as PromiseRejectedResult).reason).toMatchObject(
        reconnectError,
      );
    }
    expect(settings.neon?.reconnectRequired).toBe(true);
    expect(settings.neon?.accessToken?.value).toBe("revoked-access");
    expect(publishQueryInvalidations).toHaveBeenCalledOnce();
    expect(sendTelemetryEvent).toHaveBeenCalledExactlyOnceWith(
      "neon:reconnect-required",
      { reason: "access_token_rejected" },
    );
    // Later Neon operations stop before reaching the API.
    await expect(getNeonClient()).rejects.toMatchObject(reconnectError);
  });

  it("keeps the reconnect error through organization lookup", async () => {
    await expect(getNeonOrganizationId()).rejects.toMatchObject(reconnectError);
    expect(settings.neon?.reconnectRequired).toBe(true);
  });

  it("ignores a rejection of credentials replaced by a newer sign-in", async () => {
    const client = await getNeonClient();
    neonApi.onRequest = () =>
      handleNeonOAuthReturn({
        token: "new-access",
        refreshToken: "new-refresh",
        expiresIn: 3600,
      });

    await expect(client.getProject("project-1")).rejects.toMatchObject(
      reconnectError,
    );
    expect(settings.neon?.reconnectRequired).toBeUndefined();
    expect(settings.neon?.accessToken?.value).toBe("new-access");
    expect(sendTelemetryEvent).not.toHaveBeenCalled();
  });

  it("leaves other HTTP errors for callers to classify", async () => {
    neonApi.status = 404;
    const client = await getNeonClient();

    await expect(client.getProject("project-1")).rejects.toMatchObject({
      response: { status: 404 },
    });
    expect(settings.neon?.reconnectRequired).toBeUndefined();
    expect(sendTelemetryEvent).not.toHaveBeenCalled();
  });
});

describe("Neon API rejection of an access token that expired mid-use", () => {
  afterEach(() => vi.unstubAllGlobals());

  // A client built while its token was valid, e.g. one held across a
  // dev-branch migration's data copy, whose token has since expired.
  function longLivedClient() {
    return createNeonApiClient("expired-access", readSettings());
  }

  function stubRefresh(response: () => Response) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response()),
    );
  }

  beforeEach(() => {
    neonApi.status = 401;
    neonApi.statusByToken = {};
    neonApi.requestTokens = [];
    neonApi.onRequest = undefined;
    stubRefresh(
      () =>
        new Response(
          JSON.stringify({ accessToken: "fresh-access", expiresIn: 3600 }),
        ),
    );
  });

  it("refreshes once and retries concurrent requests with the new token", async () => {
    neonApi.statusByToken = { "fresh-access": 200 };
    const client = longLivedClient();

    const results = await Promise.all([
      client.getProject("project-1"),
      client.listProjects({}),
    ]);

    expect(results.map((result) => result.data)).toEqual([
      { token: "fresh-access" },
      { token: "fresh-access" },
    ]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(neonApi.requestTokens.sort()).toEqual([
      "expired-access",
      "expired-access",
      "fresh-access",
      "fresh-access",
    ]);
    expect(settings.neon?.accessToken?.value).toBe("fresh-access");
    expect(settings.neon?.reconnectRequired).toBe(false);
    expect(sendTelemetryEvent).not.toHaveBeenCalled();
  });

  it("requires reconnection when Neon also rejects the refreshed token", async () => {
    const client = longLivedClient();

    await expect(client.getProject("project-1")).rejects.toMatchObject({
      kind: DyadErrorKind.Auth,
      message: NEON_RECONNECT_REQUIRED_MESSAGE,
    });
    // One retry, then the unexpired refreshed token's rejection is definitive.
    expect(neonApi.requestTokens).toEqual(["expired-access", "fresh-access"]);
    expect(settings.neon?.reconnectRequired).toBe(true);
    expect(sendTelemetryEvent).toHaveBeenCalledExactlyOnceWith(
      "neon:reconnect-required",
      { reason: "access_token_rejected" },
    );
  });

  it("keeps the session when the refresh fails transiently", async () => {
    stubRefresh(() => new Response("{}", { status: 503 }));
    const client = longLivedClient();

    await expect(client.getProject("project-1")).rejects.toMatchObject({
      kind: DyadErrorKind.External,
    });
    expect(neonApi.requestTokens).toEqual(["expired-access"]);
    expect(settings.neon?.reconnectRequired).toBeUndefined();
    expect(sendTelemetryEvent).not.toHaveBeenCalled();
  });
});
