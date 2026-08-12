/**
 * dyad-auth-bootstrap.js
 *
 * Injected into the preview iframe by the proxy server. Before a recording
 * session starts, the Dyad renderer sends the isolated test user's credentials
 * and this script establishes an authenticated session the SAME way the app's
 * own login would — so the user never has to record a sign-in, and the
 * generated test's `signIn` fixture mirrors this exact path at replay time.
 *
 * - Neon / Better Auth: POST the app's own same-origin `/api/auth/sign-in/email`
 *   with credentials, so the session cookie lands wherever interactive login
 *   would put it, then reload so the app boots authenticated.
 * - Supabase: POST the password grant with the anon key, seed supabase-js's
 *   session into localStorage under `sb-<ref>-auth-token`, then reload.
 *
 * Plain, dependency-free IIFE JS. Protocol:
 *   down (from parent): { type: "dyad-auth-login", auth, nonce, token }
 *   up   (to parent):   { type: "dyad-auth-bootstrap-ready", pendingNonce? }
 *                       { type: "dyad-auth-ready", ok: boolean, error?: string }
 *
 * `nonce` identifies one sign-in attempt. Sign-in spans a document navigation
 * (sign in → replace("/") → verify), and the marker carrying state across it
 * lives in sessionStorage — scoped to the long-lived Dyad window, not to the
 * attempt. The nonce is how the new document tells "the marker this attempt just
 * wrote" from "one an earlier attempt abandoned".
 */
(() => {
  // A source check proves only which window sent the message, not that Dyad is
  // the window framing this otherwise-framable origin. The proxy embeds a
  // per-worker capability in this script tag; the trusted renderer learns the
  // matching value from main-process IPC and echoes it with the credentials.
  const authBootstrapToken = document.currentScript?.dataset.dyadAuthToken;
  const PENDING_KEY = "__dyad_auth_pending__";
  const HOME_SETTLE_DELAY_MS = 500;
  const MAX_HOME_REDIRECTS = 3;
  // Backstop for a marker the parent never adjudicates. Kept longer than the
  // renderer's 30s `AUTH_READY_TIMEOUT_MS` so a slow preview reload can't expire
  // a marker for an attempt the parent is still waiting on. The parent's nonce
  // check is the real arbiter; this is only the floor under it.
  const PENDING_TTL_MS = 45_000;

  // The marker found in sessionStorage when this document loaded, held until the
  // parent tells us which attempt it belongs to.
  let pendingOnLoad = null;
  // The attempt this document is working on, echoed back in the terminal
  // message so the parent can tell our completion from a stale one.
  let activeNonce = null;

  function post(ok, error) {
    window.parent.postMessage(
      { type: "dyad-auth-ready", ok, error, nonce: activeNonce },
      "*",
    );
  }

  function projectRef(url) {
    try {
      return new URL(url).host.split(".")[0];
    } catch {
      return null;
    }
  }

  async function neonSignIn(auth) {
    const response = await fetch("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: auth.email, password: auth.password }),
    });
    if (!response.ok) {
      throw new Error(`sign-in failed (${response.status})`);
    }
  }

  async function supabaseSignIn(auth) {
    const ref = projectRef(auth.projectUrl);
    if (!ref) throw new Error("invalid Supabase project URL");
    const base = auth.projectUrl.replace(/\/+$/, "");
    const response = await fetch(`${base}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: auth.anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: auth.email, password: auth.password }),
    });
    if (!response.ok) {
      throw new Error(`sign-in failed (${response.status})`);
    }
    const session = await response.json();
    window.localStorage.setItem(
      `sb-${ref}-auth-token`,
      JSON.stringify(session),
    );
  }

  // Land on "/" so recording starts where the generated test replays from, and
  // to avoid sticking on a "/login" route that would re-render after a bare
  // reload. Guarded so a second login message can't double-run.
  let loggingIn = false;

  function goHome() {
    location.replace("/");
  }

  function clearPending() {
    sessionStorage.removeItem(PENDING_KEY);
  }

  /** A marker older than the TTL is leftover from a previous session. */
  function isPendingStale(pending) {
    const startedAt =
      typeof pending.startedAt === "number" ? pending.startedAt : 0;
    return Date.now() - startedAt > PENDING_TTL_MS;
  }

  function failPending(error) {
    clearPending();
    post(false, error);
  }

  function redirectPendingHome(pending) {
    const homeRedirects = Number.isInteger(pending.homeRedirects)
      ? pending.homeRedirects
      : 0;
    if (homeRedirects >= MAX_HOME_REDIRECTS) {
      failPending("the app kept redirecting away from / after sign-in");
      return;
    }
    sessionStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ ...pending, homeRedirects: homeRedirects + 1 }),
    );
    goHome();
  }

  /**
   * Auth libraries resolve their initial session asynchronously, so a protected
   * route can redirect to /login shortly after load even though the session is
   * valid. Keep the marker until "/" stays stable for a short window; if the
   * app's guard wins that race, load "/" again now that its auth state is warm.
   */
  function settleAtHome(pending) {
    if (location.pathname !== "/") {
      redirectPendingHome(pending);
      return;
    }

    setTimeout(() => {
      if (location.pathname !== "/") {
        redirectPendingHome(pending);
        return;
      }

      clearPending();
      // A document navigation does not pass through history.replaceState, so
      // explicitly synchronize the preview toolbar's route with the iframe.
      window.parent.postMessage(
        {
          type: "replaceState",
          payload: { newUrl: location.href },
        },
        "*",
      );
      post(true);
    }, HOME_SETTLE_DELAY_MS);
  }

  async function login(auth, nonce) {
    if (loggingIn) return;
    loggingIn = true;
    try {
      if (auth.mode === "neon-better-auth") {
        await neonSignIn(auth);
        sessionStorage.setItem(
          PENDING_KEY,
          JSON.stringify({
            mode: auth.mode,
            nonce: nonce,
            homeRedirects: 0,
            startedAt: Date.now(),
          }),
        );
        goHome();
        return;
      }
      if (auth.mode === "supabase-password") {
        await supabaseSignIn(auth);
        sessionStorage.setItem(
          PENDING_KEY,
          JSON.stringify({
            mode: auth.mode,
            nonce: nonce,
            ref: projectRef(auth.projectUrl),
            homeRedirects: 0,
            startedAt: Date.now(),
          }),
        );
        goHome();
        return;
      }
      // Unknown/none: nothing to do, report ready.
      post(true);
    } catch (error) {
      loggingIn = false;
      post(false, error && error.message ? error.message : String(error));
    }
  }

  /**
   * Pull the access token back out of supabase-js's storage slot. The value can
   * be the raw session JSON this script seeds, or the `base64-` encoding newer
   * supabase-js rewrites it to once the app's own client has read it — either
   * shape means the app owns a session, so accept both.
   */
  function readStoredAccessToken(raw) {
    if (typeof raw !== "string" || !raw) return null;
    let text = raw;
    if (text.slice(0, 7) === "base64-") {
      try {
        const encoded = text.slice(7).replace(/-/g, "+").replace(/_/g, "/");
        const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
        const binary = atob(padded);
        text = new TextDecoder().decode(
          Uint8Array.from(binary, (char) => char.charCodeAt(0)),
        );
      } catch {
        return null;
      }
    }
    try {
      const parsed = JSON.parse(text);
      const session =
        parsed && parsed.currentSession ? parsed.currentSession : parsed;
      const token = session && session.access_token;
      return typeof token === "string" && token ? token : null;
    } catch {
      return null;
    }
  }

  /**
   * Ask Supabase whether the seeded session is real, rather than re-reading the
   * value this script wrote a moment ago — localStorage survives the reload, so
   * the write alone proves nothing about whether the app's supabase-js accepted
   * it. A `false` here is what routes the recording into the existing
   * "recording without authentication" warning instead of a silently signed-out
   * session that the generated spec's `signIn` fixture claims is signed in.
   */
  async function hasSupabaseSession(pending, auth) {
    const ref = pending.ref;
    const projectUrl = auth && auth.projectUrl;
    const anonKey = auth && auth.anonKey;
    if (!ref || !projectUrl || !anonKey) return false;
    const accessToken = readStoredAccessToken(
      localStorage.getItem(`sb-${ref}-auth-token`),
    );
    if (!accessToken) return false;
    const base = projectUrl.replace(/\/+$/, "");
    const response = await fetch(`${base}/auth/v1/user`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) return false;
    const data = await response.json().catch(() => null);
    return !!(data && data.id);
  }

  async function verifyPending(pending, auth) {
    try {
      if (pending.mode === "neon-better-auth") {
        const response = await fetch("/api/auth/get-session", {
          credentials: "include",
        });
        const data = response.ok
          ? await response.json().catch(() => null)
          : null;
        const hasUser = !!(
          data &&
          (data.user || (data.session && data.session.user))
        );
        if (!hasUser) {
          failPending("no session after sign-in");
          return;
        }
        settleAtHome(pending);
        return;
      }
      if (pending.mode === "supabase-password") {
        if (!(await hasSupabaseSession(pending, auth))) {
          failPending("no session after sign-in");
          return;
        }
        settleAtHome(pending);
        return;
      }
      settleAtHome(pending);
    } catch (error) {
      failPending(error && error.message ? error.message : String(error));
    }
  }

  /**
   * The parent has named the attempt it's waiting on. Either the marker this
   * document loaded with belongs to it — so this IS the post-sign-in reload and
   * we verify — or it belongs to a cancelled/timed-out attempt and must be
   * dropped. Verifying a foreign marker reports a phantom sign-in failure, since
   * this recording's setup cleared the cookies the marker refers to.
   */
  function handleLogin(auth, nonce) {
    const pending = pendingOnLoad;
    pendingOnLoad = null;
    activeNonce = nonce;
    if (pending && nonce && pending.nonce === nonce) {
      verifyPending(pending, auth);
      return;
    }
    if (pending) clearPending();
    login(auth, nonce);
  }

  const isFramed = window.parent !== window;

  window.addEventListener("message", (e) => {
    if (!isFramed) return;
    if (e.source !== window.parent) return;
    const data = e.data;
    if (
      data &&
      data.type === "dyad-auth-login" &&
      data.auth &&
      authBootstrapToken &&
      data.token === authBootstrapToken
    ) {
      handleLogin(
        data.auth,
        typeof data.nonce === "string" ? data.nonce : null,
      );
    }
  });

  function checkPendingOnLoad() {
    let pending = null;
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (raw) pending = JSON.parse(raw);
    } catch {
      pending = null;
    }
    if (pending && isPendingStale(pending)) {
      // Leftover from an earlier session — drop it so it can't hijack this
      // load's sign-in (or trigger a spurious redirect to "/").
      clearPending();
      pending = null;
    }
    pendingOnLoad = pending;
    // Always announce, marker or not. This doubles as the handshake that
    // survives a dev-server restart briefly leaving no bootstrap listening: the
    // parent resends `dyad-auth-login` in response.
    window.parent.postMessage(
      {
        type: "dyad-auth-bootstrap-ready",
        pendingNonce: pending && pending.nonce ? pending.nonce : null,
      },
      "*",
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkPendingOnLoad);
  } else {
    checkPendingOnLoad();
  }
})();
