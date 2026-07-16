import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listSupabaseOrganizations } from "./supabase_management_client";

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
