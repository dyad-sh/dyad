import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findApp: vi.fn(), register: vi.fn() }));
vi.mock("@/db", () => ({
  db: { query: { apps: { findFirst: mocks.findApp } } },
}));
vi.mock("@/supabase_admin/supabase_management_client", () => ({
  ensureSupabaseAuthRedirectUrls: mocks.register,
}));

import {
  ensureSupabasePreviewRedirects,
  resolveSupabasePreviewTarget,
} from "./supabase_preview_redirect_service";

const input = () => ({
  appId: 9,
  origin: "http://app-9.localhost:42999",
  target: { projectId: "branch-ref", organizationSlug: "org" },
  signal: new AbortController().signal,
});

describe("Supabase preview redirect registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findApp.mockResolvedValue({
      supabaseProjectId: "branch-ref",
      supabaseParentProjectId: "parent-ref",
      supabaseOrganizationSlug: "org",
    });
    mocks.register.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("uses the linked branch and actual bound port for existing apps", async () => {
    expect(await resolveSupabasePreviewTarget(9)).toEqual(input().target);
    mocks.findApp.mockClear();
    await ensureSupabasePreviewRedirects(input());
    expect(mocks.findApp).not.toHaveBeenCalled();
    expect(mocks.register).toHaveBeenCalledWith({
      projectId: "branch-ref",
      organizationSlug: "org",
      redirectUrls: [
        "http://app-9.localhost:42999",
        "http://app-9.localhost:42999/**",
      ],
      signal: expect.any(AbortSignal),
    });
  });

  it.each([undefined, { supabaseProjectId: null }])(
    "resolves no target for missing or unlinked apps: %j",
    async (app) => {
      mocks.findApp.mockResolvedValue(app);
      expect(await resolveSupabasePreviewTarget(9)).toBeNull();
    },
  );

  it.each([
    "not a URL",
    "http://localhost:42109",
    "http://app-8.localhost:42109",
    "http://app-9.localhost.evil:42109",
    "https://app-9.localhost:42109",
    "http://app-9.localhost",
    "http://app-9.localhost:42109/path",
    "http://user@app-9.localhost:42109",
    "http://app-9.localhost:42109?next=evil",
  ])("rejects invalid preview origins: %s", async (origin) => {
    await expect(
      ensureSupabasePreviewRedirects({ ...input(), origin }),
    ).rejects.toThrow("Invalid app preview origin");
    expect(mocks.findApp).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("does not register after cancellation", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Stopped"));
    const work = ensureSupabasePreviewRedirects({
      ...input(),
      signal: controller.signal,
    });
    await expect(work).rejects.toThrow("Stopped");
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("leaves the timeout budget to the project-locked registration", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    mocks.register.mockReturnValueOnce(new Promise(() => {}));
    const work = ensureSupabasePreviewRedirects({
      ...input(),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(1));
    expect(timeout).not.toHaveBeenCalled();
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    await expect(work).rejects.toMatchObject({ name: "TimeoutError" });
    expect(mocks.register.mock.calls[0][0].signal.aborted).toBe(true);
    await expect(
      ensureSupabasePreviewRedirects(input()),
    ).resolves.toBeUndefined();
  });
});
