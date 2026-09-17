# S-AUTH spike — verdict: CONFIRMED (9/9 checks)

Question: can `@neondatabase/auth` (the SDK Dyad's system prompt instructs models to
use) run against a **self-hosted better-auth server** at a non-Neon
`NEON_AUTH_BASE_URL`, over plain `http://localhost`, under Playwright Chromium?

**Yes on all counts.** Run `node test-browser.mjs` (with servers up) → 9/9:
sign-up via custom form, `__Secure-` cookies set and persisted on http://localhost,
session survives reload, server-side session via `/api/me` (the benchmark's pinned
contract), 401 when anonymous, sign-out, sign-in, error display on bad password.

## Load-bearing facts for neon-sim (discovered here)

1. **SDK pins `better-auth@1.4.18`** as its own dependency — the stand-in server
   must run 1.4.18 (not latest) for wire compatibility.
2. **No Neon domain validation anywhere** in `@neondatabase/auth` 0.4.2-beta —
   `baseUrl` is used verbatim (`${baseUrl}/<path>`, e.g. `/get-session`,
   `/sign-up/email`).
3. **Cookie prefix must match**: the SDK's Next proxy filters request cookies by
   prefix `__Secure-neon-auth` and re-serializes upstream `Set-Cookie` first-party
   (sameSite→Strict by default). The stand-in must set
   `advanced: { cookiePrefix: "neon-auth", useSecureCookies: true }`.
   Observed cookie names: `__Secure-neon-auth.session_token` (from upstream),
   `__Secure-neon-auth.local.session_data` (minted locally, signed with
   `NEON_AUTH_COOKIE_SECRET`).
4. **`__Secure-` + `Secure` cookies work on `http://localhost`** in (headless)
   Chromium — trustworthy-origin rules apply; the mkcert TLS front-proxy fallback
   from the design is NOT needed for the app under test.
5. Schema bootstrap: `node server/migrate.mjs` (programmatic
   `getMigrations(auth.options)`; the standalone `@better-auth/cli` has a version
   resolution bug under npx). Tables: `user`, `session`, `account`, `verification`.
6. Errors from `signIn.email` are **thrown** (AuthApiError), not returned — app
   code needs try/catch (relevant to what models must write; the AI_RULES note
   should not promise a `{ error }` return).

## Open item carried to neon-sim (task: shim)

The spike used the `public` schema of a dedicated DB. Managed Neon Auth keeps its
tables in the **`neon_auth` schema of the app's own database** and Dyad's prompt
context tells models about that schema — neon-sim must mount better-auth's tables
under `neon_auth` in each project DB (e.g. pool `options=-csearch_path=neon_auth`)
and match managed table naming so model-written JOINs against auth data work.

## Re-run

```bash
createdb spike_sauth            # once
node server/migrate.mjs         # once
node server/auth-server.mjs &   # port 7791
npx next dev -p 3100 &          # the test app
node test-browser.mjs
```
