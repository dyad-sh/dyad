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
  pathname = "/",
  authBootstrapToken = "proxy-session-token",
  fetchImpl,
}: {
  readyState?: string;
  pending?: Record<string, unknown> | null;
  preLocal?: Record<string, string>;
  pathname?: string;
  authBootstrapToken?: string;
  fetchImpl?: (...args: any[]) => Promise<any>;
} = {}) {
  const posts: any[] = [];
  const parent = { postMessage: (msg: any) => posts.push(msg) };
  let messageHandler: ((e: any) => void) | undefined;
  const timers: Array<() => void> = [];

  const localStorage = makeStorage(preLocal);
  const sessionStorage = makeStorage(
    pending
      ? {
          // Markers written by login() carry a `startedAt`; default to a fresh
          // one so verify tests aren't treated as stale. The stale-marker test
          // overrides it with an old timestamp.
          __dyad_auth_pending__: JSON.stringify({
            startedAt: Date.now(),
            ...pending,
          }),
        }
      : {},
  );
  let currentPathname = pathname;
  const location = {
    get href() {
      return `http://localhost:42100${currentPathname}`;
    },
    get pathname() {
      return currentPathname;
    },
    // The bootstrap reports the settled route as pathname + search + hash, the
    // same shape the unauthenticated start's route hint uses.
    get search() {
      return "";
    },
    get hash() {
      return "";
    },
    replace: vi.fn((target: string) => {
      currentPathname = new URL(target, location.href).pathname;
    }),
  };
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
    currentScript: {
      dataset: { dyadAuthToken: authBootstrapToken },
    },
    addEventListener: () => {},
  };

  vm.runInNewContext(bootstrapSource, {
    window: win,
    document,
    localStorage,
    sessionStorage,
    location,
    setTimeout: (callback: () => void) => {
      timers.push(callback);
      return timers.length;
    },
    fetch: fetchMock,
    URL,
    atob,
    TextDecoder,
    Uint8Array,
    console: { debug() {}, warn() {}, error() {}, log() {} },
  });

  return {
    posts,
    parent,
    replace: location.replace,
    fetchMock,
    localStorage,
    sessionStorage,
    setPathname: (nextPathname: string) => {
      currentPathname = nextPathname;
    },
    flushTimers: () => {
      const pendingTimers = timers.splice(0);
      for (const callback of pendingTimers) callback();
    },
    pendingTimerCount: () => timers.length,
    /**
     * The parent naming the attempt it's waiting on. A marker already in
     * sessionStorage is verified only when `nonce` matches the one it carries —
     * that's what tells this document's marker apart from one an earlier,
     * abandoned attempt left behind.
     */
    sendLogin: (
      auth: Record<string, unknown>,
      nonce = "attempt-1",
      token = authBootstrapToken,
    ) =>
      messageHandler?.({
        source: parent,
        data: { type: "dyad-auth-login", auth, nonce, token },
      }),
  };
}

/** The verify path re-reads `projectUrl`/`anonKey` to check the session. */
const SUPABASE_AUTH = {
  mode: "supabase-password",
  email: "e@x.test",
  password: "pw",
  projectUrl: "https://ref123.supabase.co",
  anonKey: "anon-key",
};
const NEON_AUTH = {
  mode: "neon-better-auth",
  email: "e@x.test",
  password: "pw",
};

describe("dyad auth bootstrap", () => {
  it("seeds the supabase session into localStorage and lands on the homepage", async () => {
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

    await vi.waitFor(() => expect(h.replace).toHaveBeenCalledWith("/"));
    expect(h.fetchMock).toHaveBeenCalledWith(
      "https://ref123.supabase.co/auth/v1/token?grant_type=password",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ apikey: "anon-key" }),
      }),
    );
    const stored = h.localStorage.getItem("sb-ref123-auth-token");
    expect(stored).toContain("access_token");
    const marker = JSON.parse(
      h.sessionStorage.getItem("__dyad_auth_pending__")!,
    );
    expect(marker).toMatchObject({
      mode: "supabase-password",
      ref: "ref123",
      homeRedirects: 0,
    });
    expect(typeof marker.startedAt).toBe("number");
  });

  it("signs in via the app's own Better Auth endpoint and lands on the homepage (Neon)", async () => {
    const h = setup();
    h.fetchMock.mockResolvedValue({ ok: true });

    h.sendLogin({
      mode: "neon-better-auth",
      email: "e@x.test",
      password: "pw",
    });

    await vi.waitFor(() => expect(h.replace).toHaveBeenCalledWith("/"));
    expect(h.fetchMock).toHaveBeenCalledWith(
      "/api/auth/sign-in/email",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("announces bootstrap-ready on a fresh (pre-login) load", () => {
    const h = setup();
    expect(h.posts.some((p) => p.type === "dyad-auth-bootstrap-ready")).toBe(
      true,
    );
  });

  it("ignores login messages from a framing parent without the proxy capability", () => {
    const h = setup();

    h.sendLogin(SUPABASE_AUTH, "attacker-attempt", "attacker-token");

    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.localStorage.getItem("sb-ref123-auth-token")).toBeNull();
    expect(h.sessionStorage.getItem("__dyad_auth_pending__")).toBeNull();
  });

  it("reports failure (and does not navigate) when sign-in fails", async () => {
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
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("verifies a pending supabase session once the parent claims the attempt", async () => {
    const h = setup({
      pending: {
        mode: "supabase-password",
        ref: "ref123",
        nonce: "attempt-1",
      },
      preLocal: { "sb-ref123-auth-token": '{"access_token":"a"}' },
      fetchImpl: async () => ({ ok: true, json: async () => ({ id: "u" }) }),
    });

    // Nothing happens on load alone — the marker is held until the parent says
    // whose attempt it belongs to.
    expect(h.pendingTimerCount()).toBe(0);
    expect(h.posts).toContainEqual(
      expect.objectContaining({
        type: "dyad-auth-bootstrap-ready",
        pendingNonce: "attempt-1",
      }),
    );

    h.sendLogin(SUPABASE_AUTH, "attempt-1");

    await vi.waitFor(() => expect(h.pendingTimerCount()).toBe(1));
    expect(
      h.posts.some((p) => p.type === "dyad-auth-ready" && p.ok === true),
    ).toBe(false);

    h.flushTimers();

    expect(
      h.posts.some((p) => p.type === "dyad-auth-ready" && p.ok === true),
    ).toBe(true);
    expect(h.posts).toContainEqual(
      expect.objectContaining({
        type: "replaceState",
        payload: { newUrl: "http://localhost:42100/" },
      }),
    );
    // Verified against Supabase itself, not against the value this script wrote
    // — localStorage survives the reload, so re-reading it proves nothing.
    expect(h.fetchMock).toHaveBeenCalledWith(
      "https://ref123.supabase.co/auth/v1/user",
      expect.objectContaining({
        headers: expect.objectContaining({
          apikey: "anon-key",
          Authorization: "Bearer a",
        }),
      }),
    );
    // The pending marker is consumed so a later reload doesn't re-verify.
    expect(h.sessionStorage.getItem("__dyad_auth_pending__")).toBeNull();
  });

  // Newer supabase-js re-saves the session under a `base64-` encoding once its
  // own client reads the slot. That is still an authenticated app, so the token
  // has to come back out rather than reading as "no session".
  it("verifies a supabase session the app re-saved in base64 form", async () => {
    const session = JSON.stringify({ access_token: "a", user: { id: "u" } });
    const h = setup({
      pending: {
        mode: "supabase-password",
        ref: "ref123",
        nonce: "attempt-1",
      },
      preLocal: {
        "sb-ref123-auth-token": `base64-${Buffer.from(session, "utf8")
          .toString("base64url")
          .replace(/=+$/, "")}`,
      },
      fetchImpl: async () => ({ ok: true, json: async () => ({ id: "u" }) }),
    });

    h.sendLogin(SUPABASE_AUTH, "attempt-1");

    await vi.waitFor(() => expect(h.pendingTimerCount()).toBe(1));
    h.flushTimers();
    expect(
      h.posts.some((p) => p.type === "dyad-auth-ready" && p.ok === true),
    ).toBe(true);
  });

  // The seeded write always succeeds; only Supabase can say whether the app's
  // client actually holds a session. Reporting `ok` here would record a
  // signed-out flow into a spec whose `signIn` fixture claims otherwise.
  it("fails supabase verification when the seeded session is rejected", async () => {
    const h = setup({
      pending: {
        mode: "supabase-password",
        ref: "ref123",
        nonce: "attempt-1",
      },
      preLocal: { "sb-ref123-auth-token": '{"access_token":"a"}' },
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({}),
      }),
    });

    h.sendLogin(SUPABASE_AUTH, "attempt-1");

    await vi.waitFor(() =>
      expect(
        h.posts.some((p) => p.type === "dyad-auth-ready" && p.ok === false),
      ).toBe(true),
    );
    expect(h.sessionStorage.getItem("__dyad_auth_pending__")).toBeNull();
  });

  it("verifies a pending Neon session via get-session", async () => {
    const h = setup({
      pending: { mode: "neon-better-auth", nonce: "attempt-1" },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ user: { id: "u" } }),
      }),
    });

    h.sendLogin(NEON_AUTH, "attempt-1");

    await vi.waitFor(() => expect(h.pendingTimerCount()).toBe(1));
    h.flushTimers();
    expect(
      h.posts.some((p) => p.type === "dyad-auth-ready" && p.ok === true),
    ).toBe(true);
    expect(h.fetchMock).toHaveBeenCalledWith(
      "/api/auth/get-session",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("returns to / when the app auth guard redirects during session startup", async () => {
    const h = setup({
      pending: {
        mode: "supabase-password",
        ref: "ref123",
        nonce: "attempt-1",
      },
      preLocal: { "sb-ref123-auth-token": '{"access_token":"a"}' },
      fetchImpl: async () => ({ ok: true, json: async () => ({ id: "u" }) }),
    });

    h.sendLogin(SUPABASE_AUTH, "attempt-1");

    await vi.waitFor(() => expect(h.pendingTimerCount()).toBe(1));
    // Simulate a protected-route effect moving the iframe after the bootstrap
    // has verified storage but before it acknowledges authentication.
    h.setPathname("/login");
    // The move itself only re-arms the settle window; it is the URL *resting*
    // on a login route that identifies the guard race.
    h.flushTimers();
    expect(h.replace).not.toHaveBeenCalled();
    h.flushTimers();

    expect(h.replace).toHaveBeenCalledWith("/");
    expect(
      h.posts.some((p) => p.type === "dyad-auth-ready" && p.ok === true),
    ).toBe(false);
    expect(
      JSON.parse(h.sessionStorage.getItem("__dyad_auth_pending__")!),
    ).toMatchObject({
      mode: "supabase-password",
      ref: "ref123",
      homeRedirects: 1,
    });
  });

  it("accepts a stable landing route as the post-login destination", async () => {
    // An app that sends authenticated users from "/" to "/dashboard" has signed
    // in successfully. Reporting failure here would leave the established
    // session in place while the parent downgrades the draft to
    // `authMode: "none"`, so the generated spec omits `signIn(page)` and
    // replays the dashboard flow from a signed-out context.
    const h = setup({
      pending: {
        mode: "supabase-password",
        ref: "ref123",
        nonce: "attempt-1",
      },
      preLocal: { "sb-ref123-auth-token": '{"access_token":"a"}' },
      fetchImpl: async () => ({ ok: true, json: async () => ({ id: "u" }) }),
    });

    h.sendLogin(SUPABASE_AUTH, "attempt-1");

    await vi.waitFor(() => expect(h.pendingTimerCount()).toBe(1));
    h.setPathname("/dashboard");
    // First window sees the move and re-arms; the second finds it at rest.
    h.flushTimers();
    h.flushTimers();

    expect(h.replace).not.toHaveBeenCalled();
    // The settled route rides along, so the parent can open the spec on the page
    // the capture actually ran against.
    expect(h.posts).toContainEqual(
      expect.objectContaining({
        type: "dyad-auth-ready",
        ok: true,
        path: "/dashboard",
      }),
    );
    // The toolbar follows the iframe to wherever the app actually landed.
    expect(h.posts).toContainEqual({
      type: "replaceState",
      payload: { newUrl: "http://localhost:42100/dashboard" },
    });
    expect(h.sessionStorage.getItem("__dyad_auth_pending__")).toBeNull();
  });

  it("gives up when the app never comes to rest after sign-in", async () => {
    const h = setup({
      pending: { mode: "neon-better-auth", nonce: "attempt-1" },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ user: { id: "u" } }),
      }),
    });

    h.sendLogin(NEON_AUTH, "attempt-1");

    await vi.waitFor(() => expect(h.pendingTimerCount()).toBe(1));
    // Moving on every window: the destination itself is the unstable thing, so
    // extra settle windows never find it at rest.
    for (const next of ["/a", "/b", "/c"]) {
      h.setPathname(next);
      h.flushTimers();
    }

    expect(h.replace).toHaveBeenCalledWith("/");
    expect(
      JSON.parse(h.sessionStorage.getItem("__dyad_auth_pending__")!),
    ).toMatchObject({ homeRedirects: 1 });
  });

  it("signs in fresh when the marker belongs to an abandoned attempt", async () => {
    // A prior attempt crashed or was cancelled inside the 15-second TTL, so its
    // marker is still there and still "fresh". Verifying it would check cookies
    // and localStorage that this recording's setup already cleared, report a
    // phantom sign-in failure, and start the session signed out.
    const h = setup({
      pending: { mode: "neon-better-auth", nonce: "attempt-0" },
    });
    h.fetchMock.mockResolvedValue({ ok: true });

    expect(h.posts).toContainEqual(
      expect.objectContaining({
        type: "dyad-auth-bootstrap-ready",
        pendingNonce: "attempt-0",
      }),
    );

    h.sendLogin(NEON_AUTH, "attempt-1");

    await vi.waitFor(() => expect(h.replace).toHaveBeenCalledWith("/"));
    expect(h.fetchMock).toHaveBeenCalledWith(
      "/api/auth/sign-in/email",
      expect.objectContaining({ method: "POST" }),
    );
    expect(
      h.posts.some((p) => p.type === "dyad-auth-ready" && p.ok === false),
    ).toBe(false);
    // The abandoned marker was replaced by this attempt's own.
    expect(
      JSON.parse(h.sessionStorage.getItem("__dyad_auth_pending__")!),
    ).toMatchObject({ mode: "neon-better-auth", nonce: "attempt-1" });
  });

  it("ignores a stale pending marker left by a previous session", () => {
    const h = setup({
      pending: {
        mode: "neon-better-auth",
        homeRedirects: 0,
        // Older than PENDING_TTL_MS (45s) — leftover from a prior session.
        startedAt: Date.now() - 60_000,
      },
    });

    // Rather than verifying the (non-existent) session and reporting failure,
    // the bootstrap drops the marker and announces readiness for a fresh login.
    expect(h.posts.some((p) => p.type === "dyad-auth-bootstrap-ready")).toBe(
      true,
    );
    expect(
      h.posts.some((p) => p.type === "dyad-auth-ready" && p.ok === false),
    ).toBe(false);
    expect(h.sessionStorage.getItem("__dyad_auth_pending__")).toBeNull();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
});
