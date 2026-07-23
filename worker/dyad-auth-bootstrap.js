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
 *   down (from parent): { type: "dyad-auth-login", auth }
 *   up   (to parent):   { type: "dyad-auth-ready", ok: boolean, error?: string }
 */
(() => {
  const PENDING_KEY = "__dyad_auth_pending__";
  const HOME_SETTLE_DELAY_MS = 500;
  const MAX_HOME_REDIRECTS = 3;

  function post(ok, error) {
    window.parent.postMessage({ type: "dyad-auth-ready", ok, error }, "*");
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

  // After signing in, land on the app's homepage ("/") so recording starts
  // from the same place the generated test replays from (goto("/")). This also
  // avoids getting stuck on a "/login" route that would re-render after a bare
  // reload. Once signed in, guard so a second login message can't double-run.
  let loggingIn = false;

  function goHome() {
    location.replace("/");
  }

  function clearPending() {
    sessionStorage.removeItem(PENDING_KEY);
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
   * Auth libraries commonly resolve their initial session asynchronously. A
   * protected route can therefore redirect to /login shortly after the page
   * has loaded, even though the session we just established is valid.
   *
   * Keep the pending marker until "/" remains stable for a short window. If
   * the app's guard wins that race, load "/" once more now that its auth state
   * is warm. Only then tell Dyad that recording can begin.
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

  async function login(auth) {
    if (loggingIn) return;
    loggingIn = true;
    try {
      if (auth.mode === "neon-better-auth") {
        await neonSignIn(auth);
        sessionStorage.setItem(
          PENDING_KEY,
          JSON.stringify({ mode: auth.mode, homeRedirects: 0 }),
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
            ref: projectRef(auth.projectUrl),
            homeRedirects: 0,
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

  async function verifyPending(pending) {
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
        const ok = !!(
          pending.ref && localStorage.getItem(`sb-${pending.ref}-auth-token`)
        );
        if (!ok) {
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

  window.addEventListener("message", (e) => {
    if (e.source !== window.parent) return;
    const data = e.data;
    if (data && data.type === "dyad-auth-login" && data.auth) {
      login(data.auth);
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
    if (!pending) {
      // Fresh (pre-login) load: tell the parent we're ready to receive
      // credentials. The parent (re)sends `dyad-auth-login` in response, so the
      // handshake can't race a dev-server restart / reload that briefly leaves
      // no bootstrap listening.
      window.parent.postMessage({ type: "dyad-auth-bootstrap-ready" }, "*");
      return;
    }
    verifyPending(pending);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkPendingOnLoad);
  } else {
    checkPendingOnLoad();
  }
})();
