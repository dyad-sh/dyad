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
  SUPABASE_PREVIEW_REGISTRATION_TIMEOUT_MS,
} from "./supabase_preview_redirect_service";

const input = () => ({
  appId: 9,
  origin: "http://app-9.localhost:42999",
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
    await ensureSupabasePreviewRedirects(input());
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
    "skips missing or unlinked apps: %j",
    async (app) => {
      mocks.findApp.mockResolvedValue(app);
      await ensureSupabasePreviewRedirects(input());
      expect(mocks.register).not.toHaveBeenCalled();
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

  it("does not register after cancellation while reading the association", async () => {
    let finish!: (app: unknown) => void;
    mocks.findApp.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const controller = new AbortController();
    const work = ensureSupabasePreviewRedirects({
      ...input(),
      signal: controller.signal,
    });
    controller.abort(new Error("Stopped"));
    await expect(work).rejects.toThrow("Stopped");
    finish({
      supabaseProjectId: "old-project",
      supabaseOrganizationSlug: "org",
    });
    await Promise.resolve();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("bounds registration and allows a subsequent retry", async () => {
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(controller.signal);
    mocks.register.mockReturnValueOnce(new Promise(() => {}));
    const work = ensureSupabasePreviewRedirects(input());
    await vi.waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(1));
    expect(timeout).toHaveBeenCalledWith(
      SUPABASE_PREVIEW_REGISTRATION_TIMEOUT_MS,
    );
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    await expect(work).rejects.toMatchObject({ name: "TimeoutError" });
    expect(mocks.register.mock.calls[0][0].signal.aborted).toBe(true);
    await expect(
      ensureSupabasePreviewRedirects(input()),
    ).resolves.toBeUndefined();
  });
});
