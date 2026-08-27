import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseManagementAPIError } from "@dyad-sh/supabase-management-js";
import {
  classifyManagementApiError,
  getProjectApiKeys,
  getSupabaseProjectLogs,
  listSupabaseOrganizations,
  refreshSupabaseToken,
} from "./supabase_management_client";
import { hasSupabaseCredentialsForOrganization } from "../lib/schemas";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({})),
  writeSettings: vi.fn(),
}));

describe("hasSupabaseCredentialsForOrganization", () => {
  const settings = {
    supabase: {
      accessToken: { value: "legacy" },
      organizations: {
        connected: {
          accessToken: { value: "organization-token" },
          refreshToken: { value: "organization-refresh-token" },
          expiresIn: 3600,
          tokenTimestamp: 1,
        },
      },
    },
  } as const;

  it("uses the linked organization token when a slug is present", () => {
    expect(hasSupabaseCredentialsForOrganization(settings, "connected")).toBe(
      true,
    );
    expect(hasSupabaseCredentialsForOrganization(settings, "missing")).toBe(
      false,
    );
  });

  it("uses legacy credentials only for an unscoped app", () => {
    expect(hasSupabaseCredentialsForOrganization(settings, null)).toBe(true);
  });
});

describe("listSupabaseOrganizations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries a transient 401 from a newly issued OAuth token", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response('{"message":"Unauthorized"}', {
          status: 401,
          statusText: "Unauthorized",
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "org-1", slug: "example" }]), {
          status: 200,
        }),
      );

    const resultPromise = listSupabaseOrganizations("new-token");
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toEqual([
      { id: "org-1", slug: "example" },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry other authorization failures", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"message":"Forbidden"}', {
        status: 403,
        statusText: "Forbidden",
      }),
    );

    await expect(listSupabaseOrganizations("invalid-token")).rejects.toThrow(
      "Failed to fetch organizations: Forbidden",
    );
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("refreshSupabaseToken", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shares one refresh request across concurrent callers", async () => {
    vi.mocked(readSettings).mockReturnValue({
      supabase: {
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

    const first = refreshSupabaseToken();
    const second = refreshSupabaseToken();
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
});

describe("getProjectApiKeys", () => {
  beforeEach(() => {
    vi.mocked(readSettings).mockReturnValue({
      supabase: {
        organizations: {
          "org-1": {
            accessToken: { value: "org-token" },
            expiresIn: 3600,
            tokenTimestamp: Math.floor(Date.now() / 1000),
          },
        },
      },
    } as unknown as ReturnType<typeof readSettings>);
  });

  afterEach(() => vi.unstubAllGlobals());

  // Supabase redacts secret key VALUES unless the request asks to reveal them,
  // so an admin caller that forgets the flag can only ever use the legacy JWT.
  it("reveals secret key values only when asked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );

    await getProjectApiKeys({
      projectId: "proj-1",
      organizationSlug: "org-1",
      reveal: true,
    });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "https://api.supabase.com/v1/projects/proj-1/api-keys?reveal=true",
    );

    await getProjectApiKeys({ projectId: "proj-1", organizationSlug: "org-1" });
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe(
      "https://api.supabase.com/v1/projects/proj-1/api-keys",
    );
  });

  // This response decides which key the app authenticates with. A 200 carrying
  // something other than an array would otherwise surface as an unclassified
  // TypeError from `keys.find` — and inside detectLegacyAppKey, which swallows
  // failures, it would silently suppress the legacy-key warning entirely.
  it("rejects a 200 whose body isn't a list of keys", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "something went wrong" }), {
            status: 200,
          }),
      ),
    );

    const error = await getProjectApiKeys({
      projectId: "proj-1",
      organizationSlug: "org-1",
    }).catch((thrown) => thrown);

    expect(isDyadError(error)).toBe(true);
    expect((error as DyadError).kind).toBe(DyadErrorKind.External);
  });

  // Without `reveal`, Supabase lists secret keys but withholds their values.
  // That is the common path (client generation, legacy-key detection), so
  // rejecting it would fail key loading for a perfectly valid response and
  // silently suppress the migration warning.
  it.each([
    ["null", null],
    ["omitted", undefined],
  ])(
    "accepts a secret entry whose value is redacted (%s)",
    async (_l, value) => {
      const secret: Record<string, unknown> = {
        name: "default",
        type: "secret",
      };
      if (value !== undefined) {
        secret.api_key = value;
      }
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify([
                {
                  name: "anon",
                  type: "publishable",
                  api_key: "sb_publishable_a",
                },
                secret,
              ]),
              { status: 200 },
            ),
        ),
      );

      const keys = await getProjectApiKeys({
        projectId: "proj-1",
        organizationSlug: "org-1",
      });

      expect(keys).toHaveLength(2);
      expect(keys[0].api_key).toBe("sb_publishable_a");
    },
  );

  // Supabase may add key types; an unknown one must not fail the whole request,
  // because the keys around it are still what the app authenticates with.
  it("passes through keys carrying an unfamiliar type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              { name: "default", type: "something-new", api_key: "sb_x" },
            ]),
            { status: 200 },
          ),
      ),
    );

    await expect(
      getProjectApiKeys({ projectId: "proj-1", organizationSlug: "org-1" }),
    ).resolves.toEqual([
      { name: "default", type: "something-new", api_key: "sb_x" },
    ]);
  });
});

describe("getSupabaseProjectLogs", () => {
  beforeEach(() => {
    vi.mocked(readSettings).mockReturnValue({
      supabase: {
        organizations: {
          "org-1": {
            accessToken: { value: "org-token" },
            expiresIn: 3600,
            tokenTimestamp: Math.floor(Date.now() / 1000),
          },
        },
      },
    } as unknown as ReturnType<typeof readSettings>);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("queries and maps the unified ClickHouse logs endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              result: [
                {
                  timestamp: "2026-08-22T00:01:02.345000",
                  event_message: "warning from function",
                  severity_text: "warning",
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    const timestampStart = Date.UTC(2026, 7, 22, 0, 0, 0);
    const response = await getSupabaseProjectLogs(
      "proj-1",
      timestampStart,
      "org-1",
    );

    const requestUrl = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(requestUrl.pathname).toBe(
      "/v1/projects/proj-1/analytics/endpoints/logs",
    );
    const sql = requestUrl.searchParams.get("sql");
    expect(sql).toContain("FROM logs");
    expect(sql).toContain("WHERE source = 'function_logs'");
    expect(sql).not.toContain("FROM function_logs");
    expect(sql).not.toContain("metadata");
    expect(sql).not.toContain("TIMESTAMP_MICROS");
    expect(requestUrl.searchParams.get("iso_timestamp_start")).toBe(
      "2026-08-22T00:00:00.000Z",
    );
    expect(requestUrl.searchParams.has("iso_timestamp_end")).toBe(true);
    expect(response).toEqual({
      result: [
        {
          timestamp: Date.UTC(2026, 7, 22, 0, 1, 2, 345),
          event_message: "warning from function",
          level: "warn",
        },
      ],
      error: undefined,
    });
  });
});

describe("classifyManagementApiError", () => {
  it("maps a Management API 401/403 to an Auth DyadError", () => {
    for (const status of [401, 403]) {
      const error = classifyManagementApiError(
        new SupabaseManagementAPIError(
          // Built from `status`, so the 401 iteration doesn't carry a message
          // claiming 403 — a mislabelled fixture can't catch a regression that
          // depends on the reported status, and makes failures harder to read.
          `Failed to get project api keys: ${
            status === 401 ? "Unauthorized" : "Forbidden"
          } (${status})`,
          new Response(null, { status }),
        ),
        "update this app's API key",
      );

      expect(isDyadError(error)).toBe(true);
      // Auth is telemetry-filtered and drives the reconnect path; an
      // unclassified error would be reported as a product exception instead.
      expect((error as DyadError).kind).toBe(DyadErrorKind.Auth);
    }
  });

  it("preserves an already-classified DyadError", () => {
    const original = new DyadError("nope", DyadErrorKind.Precondition);

    expect(classifyManagementApiError(original, "do a thing")).toBe(original);
  });

  it("leaves unrelated failures alone", () => {
    const original = new Error("socket hang up");

    expect(classifyManagementApiError(original, "do a thing")).toBe(original);
  });
});
