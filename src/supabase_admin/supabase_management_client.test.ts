import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteSupabaseFunction,
  listSupabaseOrganizations,
  refreshSupabaseToken,
} from "./supabase_management_client";
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

describe("deleteSupabaseFunction", () => {
  beforeEach(() => {
    vi.mocked(readSettings).mockReturnValue({
      supabase: {
        accessToken: { value: "management-token" },
        expiresIn: 3_600,
        tokenTimestamp: Math.floor(Date.now() / 1_000),
      },
    } as ReturnType<typeof readSettings>);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses an abortable DELETE request against the management API", async () => {
    const controller = new AbortController();

    await deleteSupabaseFunction({
      supabaseProjectId: "project/ref",
      functionName: "function name",
      organizationSlug: null,
      signal: controller.signal,
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.supabase.com/v1/projects/project%2Fref/functions/function%20name",
      {
        method: "DELETE",
        headers: { Authorization: "Bearer management-token" },
        signal: controller.signal,
      },
    );
  });
});
