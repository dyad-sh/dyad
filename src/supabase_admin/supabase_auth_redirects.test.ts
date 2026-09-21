import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSupabaseAuthRedirectUrls } from "./supabase_management_client";
import { readSettings } from "@/main/settings";
import { DyadErrorKind } from "@/errors/dyad_error";

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(),
  writeSettings: vi.fn(),
}));
vi.mock("@/ipc/utils/test_utils", () => ({ IS_TEST_BUILD: false }));

const origin = "http://app-9.localhost:42999";
const input = () => ({
  projectId: "branch-project",
  organizationSlug: "org-1",
  redirectUrls: [origin, `${origin}/**`],
  signal: new AbortController().signal,
});

describe("Supabase Auth preview redirect allowlist", () => {
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
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("appends both root and nested callbacks, preserving Site URL and existing entries", async () => {
    const existing =
      "https://production.example/auth/callback,http://localhost:3000/**,http://app-8.localhost:42108/**";
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          uri_allow_list: existing,
          site_url: "https://production.example",
          smtp_pass: "private",
        }),
      )
      .mockResolvedValueOnce(Response.json({}));
    const request = input();
    await ensureSupabaseAuthRedirectUrls(request);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.supabase.com/v1/projects/branch-project/config/auth",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer org-token" }),
        signal: request.signal,
      }),
    );
    expect(
      JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string),
    ).toEqual({
      uri_allow_list: `${existing},${origin},${origin}/**`,
    });
    expect(vi.mocked(fetch).mock.calls[1][1]).toMatchObject({
      method: "PATCH",
      signal: request.signal,
    });
  });

  it("does not write when callbacks are already registered", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ uri_allow_list: ` ${origin}, ${origin}/** ` }),
    );
    await ensureSupabaseAuthRedirectUrls(input());
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["", null])(
    "initializes an empty allowlist (%s)",
    async (uri_allow_list) => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(Response.json({ uri_allow_list }))
        .mockResolvedValueOnce(Response.json({}));
      await ensureSupabaseAuthRedirectUrls(input());
      expect(
        JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string),
      ).toEqual({
        uri_allow_list: `${origin},${origin}/**`,
      });
    },
  );

  it.each([{}, { uri_allow_list: [] }])(
    "does not overwrite a malformed configuration: %j",
    async (config) => {
      vi.mocked(fetch).mockResolvedValue(Response.json(config));
      await expect(
        ensureSupabaseAuthRedirectUrls(input()),
      ).rejects.toMatchObject({ kind: DyadErrorKind.External });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([401, 403])(
    "classifies a %s as an account/access problem",
    async (status) => {
      vi.mocked(fetch).mockResolvedValue(
        Response.json({ message: "Not authorized" }, { status }),
      );
      await expect(
        ensureSupabaseAuthRedirectUrls(input()),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Auth });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("surfaces rejected updates instead of reporting success", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ uri_allow_list: "" }))
      .mockResolvedValueOnce(
        Response.json({ message: "Not authorized" }, { status: 403 }),
      );
    await expect(ensureSupabaseAuthRedirectUrls(input())).rejects.toMatchObject(
      { kind: DyadErrorKind.Auth },
    );
  });

  it("serializes two apps sharing a project so neither callback is lost", async () => {
    let allowlist = "https://production.example/**";
    let releaseRead!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let reads = 0;
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (init?.method === "PATCH") {
        allowlist = JSON.parse(init.body as string).uri_allow_list;
        return Response.json({});
      }
      reads++;
      const snapshot = allowlist;
      await gate;
      return Response.json({ uri_allow_list: snapshot });
    });
    const first = ensureSupabaseAuthRedirectUrls(input());
    const second = ensureSupabaseAuthRedirectUrls({
      ...input(),
      redirectUrls: ["http://app-10.localhost:42110/**"],
    });
    await vi.waitFor(() => expect(reads).toBe(1));
    releaseRead();
    await Promise.all([first, second]);
    expect(allowlist.split(",")).toEqual([
      "https://production.example/**",
      origin,
      `${origin}/**`,
      "http://app-10.localhost:42110/**",
    ]);
  });

  it("cancels pending reads without allowing a late response to write", async () => {
    const controller = new AbortController();
    let finishRead!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise((resolve) => {
        finishRead = resolve;
      }),
    );
    const work = ensureSupabaseAuthRedirectUrls({
      ...input(),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    controller.abort(new Error("Stopped"));
    await expect(work).rejects.toThrow("Stopped");
    finishRead(Response.json({ uri_allow_list: "" }));
    // A new attempt must be able to acquire the project lock and recover.
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ uri_allow_list: input().redirectUrls.join(",") }),
    );
    await ensureSupabaseAuthRedirectUrls(input());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(fetch).mock.calls.every(([, init]) => init?.method !== "PATCH"),
    ).toBe(true);
  });

  it("skips cancelled callers waiting for another app's project lock", async () => {
    let finishRead!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise((resolve) => {
        finishRead = resolve;
      }),
    );
    const first = ensureSupabaseAuthRedirectUrls(input());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const controller = new AbortController();
    const second = ensureSupabaseAuthRedirectUrls({
      ...input(),
      signal: controller.signal,
    });
    controller.abort(new Error("Stopped"));
    await expect(second).rejects.toThrow("Stopped");
    finishRead(
      Response.json({ uri_allow_list: input().redirectUrls.join(",") }),
    );
    await first;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
