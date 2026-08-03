import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseManagementAPIError } from "@dyad-sh/supabase-management-js";
import {
  classifyManagementApiError,
  getProjectApiKeys,
  listSupabaseOrganizations,
  refreshSupabaseToken,
} from "./supabase_management_client";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({})),
  writeSettings: vi.fn(),
}));

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
});

describe("classifyManagementApiError", () => {
  it("maps a Management API 401/403 to an Auth DyadError", () => {
    for (const status of [401, 403]) {
      const error = classifyManagementApiError(
        new SupabaseManagementAPIError(
          "Failed to get project api keys: Forbidden (403)",
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
