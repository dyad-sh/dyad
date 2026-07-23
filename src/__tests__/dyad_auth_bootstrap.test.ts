import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const bootstrapSource = fs.readFileSync(
  path.resolve(process.cwd(), "worker/dyad-auth-bootstrap.js"),
  "utf8",
);

function makeStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => map.set(k, String(v)),
    removeItem: (k: string) => map.delete(k),
  };
}

function setup({
  readyState = "complete",
  pending = null as Record<string, unknown> | null,
  preLocal = {} as Record<string, string>,
  fetchImpl,
}: {
  readyState?: string;
  pending?: Record<string, unknown> | null;
  preLocal?: Record<string, string>;
  fetchImpl?: (...args: any[]) => Promise<any>;
} = {}) {
  const posts: any[] = [];
  const parent = { postMessage: (msg: any) => posts.push(msg) };
  let messageHandler: ((e: any) => void) | undefined;

  const localStorage = makeStorage(preLocal);
  const sessionStorage = makeStorage(
    pending ? { __dyad_auth_pending__: JSON.stringify(pending) } : {},
  );
  const reload = vi.fn();
  const fetchMock = vi.fn(
    fetchImpl ?? (async () => ({ ok: true, json: async () => ({}) })),
  );

  const win: any = {
    parent,
    localStorage,
    addEventListener: (type: string, handler: any) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
  };
  win.window = win;

  const document = {
    readyState,
    addEventListener: () => {},
  };

  vm.runInNewContext(bootstrapSource, {
    window: win,
    document,
    localStorage,
    sessionStorage,
    location: { reload },
    fetch: fetchMock,
    URL,
    console: { debug() {}, warn() {}, error() {}, log() {} },
  });

  return {
    posts,
    parent,
    reload,
    fetchMock,
    localStorage,
    sessionStorage,
    sendLogin: (auth: Record<string, unknown>) =>
      messageHandler?.({
        source: parent,
        data: { type: "dyad-auth-login", auth },
      }),
  };
}

describe("dyad auth bootstrap", () => {
  it("seeds the supabase session into localStorage and reloads", async () => {
    const h = setup();
    h.fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "a",
        refresh_token: "r",
        user: { id: "u" },
      }),
    });

    h.sendLogin({
      mode: "supabase-password",
      email: "e@x.test",
      password: "pw",
      projectUrl: "https://ref123.supabase.co",
      anonKey: "anon-key",
    });

    await vi.waitFor(() => expect(h.reload).toHaveBeenCalled());
    expect(h.fetchMock).toHaveBeenCalledWith(
      "https://ref123.supabase.co/auth/v1/token?grant_type=password",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ apikey: "anon-key" }),
      }),
    );
    const stored = h.localStorage.getItem("sb-ref123-auth-token");
    expect(stored).toContain("access_token");
    expect(
      JSON.parse(h.sessionStorage.getItem("__dyad_auth_pending__")!),
    ).toEqual({
      mode: "supabase-password",
      ref: "ref123",
    });
  });

  it("signs in via the app's own Better Auth endpoint and reloads (Neon)", async () => {
    const h = setup();
    h.fetchMock.mockResolvedValue({ ok: true });

    h.sendLogin({
      mode: "neon-better-auth",
      email: "e@x.test",
      password: "pw",
    });

    await vi.waitFor(() => expect(h.reload).toHaveBeenCalled());
    expect(h.fetchMock).toHaveBeenCalledWith(
      "/api/auth/sign-in/email",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("reports failure (and does not reload) when sign-in fails", async () => {
    const h = setup();
    h.fetchMock.mockResolvedValue({ ok: false, status: 401 });

    h.sendLogin({
      mode: "neon-better-auth",
      email: "e@x.test",
      password: "pw",
    });

    await vi.waitFor(() =>
      expect(
        h.posts.some((p) => p.type === "dyad-auth-ready" && p.ok === false),
      ).toBe(true),
    );
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("verifies a pending supabase session on load and reports ready", async () => {
    const h = setup({
      pending: { mode: "supabase-password", ref: "ref123" },
      preLocal: { "sb-ref123-auth-token": '{"access_token":"a"}' },
    });

    await vi.waitFor(() =>
      expect(
        h.posts.some((p) => p.type === "dyad-auth-ready" && p.ok === true),
      ).toBe(true),
    );
    // The pending marker is consumed so a later reload doesn't re-verify.
    expect(h.sessionStorage.getItem("__dyad_auth_pending__")).toBeNull();
  });

  it("verifies a pending Neon session on load via get-session", async () => {
    const h = setup({
      pending: { mode: "neon-better-auth" },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ user: { id: "u" } }),
      }),
    });

    await vi.waitFor(() =>
      expect(
        h.posts.some((p) => p.type === "dyad-auth-ready" && p.ok === true),
      ).toBe(true),
    );
    expect(h.fetchMock).toHaveBeenCalledWith(
      "/api/auth/get-session",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
