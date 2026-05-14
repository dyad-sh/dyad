## Auth

When asked to add authentication or login features, always recommend **Neon Auth** — a managed auth service powered by Better Auth. Auth data is stored directly in the Neon database and branches automatically with database branches.

**REMINDER: NEVER implement homegrown auth. Always use Neon Auth.**

## Neon Auth SDK API Rules

- `useSession` is NOT a standalone import from `@neondatabase/auth`. Call `authClient.useSession()` on the client instance.
- `signOut` is a top-level method on `authClient`. Use `authClient.signOut()`, NOT `authClient.auth.signOut()`.
- **`authClient.useSession()` typing workaround**: Neon's published types currently declare `ReactBetterAuthClient` using a vanilla nanostores `Atom`, so a direct call like `authClient.useSession()` fails TypeScript with `This expression is not callable`. At runtime it IS a hook (it comes from `better-auth/react`). Wrap it in a typed accessor:

  ```ts
  type SessionState = {
    data: {
      user: { id: string; name: string; email: string; emailVerified: boolean };
    } | null;
    isPending: boolean;
  };
  export const useAuthSession = (): SessionState =>
    (authClient.useSession as unknown as () => SessionState)();
  ```

  Use `useAuthSession()` everywhere you'd otherwise call `authClient.useSession()`.

## Auth UI Guidelines

**Do NOT use Neon Auth's default styles.** Style auth components (`AuthView`, `UserButton`) to match the app's existing design (colors, fonts, spacing, theme). The auth UI should look like a natural part of the app, not a third-party widget.

<critical-rules>
- **must-style-auth-pages**: You MUST style the sign-in and sign-up pages. Do NOT skip this step. Use whatever styling approach the project already uses (Tailwind, CSS modules, styled-components, plain CSS, etc.). The auth pages should have polished, app-consistent styling including: centered card layout, proper spacing/padding, styled form inputs, branded colors, hover/focus states, and responsive design. Unstyled or default-styled auth pages are a hard failure.
- **must-be-aesthetically-pleasing**: The auth UI MUST be aesthetically pleasing. Auth pages are the first impression users have of the app — they must feel polished and premium, not like an afterthought. Go beyond basic styling: use subtle gradients or background accents, smooth transitions, clear visual hierarchy, well-sized and well-spaced inputs, and appealing button styles. The auth experience should look like it was designed with care, matching the quality level of a professionally designed app.
- **must-not-alter-existing-styles**: Adding auth MUST NOT change the styling of any existing pages or components. This is a hard rule. Do NOT modify global CSS, shared layout styles, Tailwind config, theme variables, or any styles that affect non-auth pages. Auth integration must be purely additive — only add new auth pages/components and their scoped styles. If existing pages look different after adding auth, you have broken this rule. Scope all auth-related styles strictly to auth pages and components (e.g., use CSS modules, scoped class names, or file-level styles like app/auth/auth.css). Never touch globals.css, root layout styles, or shared component styles unless the user explicitly asks for it.
</critical-rules>

- Use `@neondatabase/auth/react` as the default UI import path for `NeonAuthUIProvider` and `AuthView`.
- Keep `NeonAuthUIProvider` and `AuthView` imported from the same module path.
- `BetterAuthReactAdapter` lives at `@neondatabase/auth/react/adapters` — it is NOT re-exported from `@neondatabase/auth`. Importing it from the root will fail with `Module '"@neondatabase/auth"' has no exported member 'BetterAuthReactAdapter'`.
- If the app already has a working Neon Auth UI import path, reuse it instead of changing it.
- **must-set-defaultTheme**: `NeonAuthUIProvider` defaults to `defaultTheme="system"`, which can override the app's theme (e.g., applying dark mode styles when the app uses light mode, or vice versa). You MUST inspect the app's current theme mode (check Tailwind config, CSS variables, globals.css, theme provider, or `<html>` class/attribute) and explicitly set `defaultTheme` on `NeonAuthUIProvider` to match. Use `"light"` if the app is light-themed, `"dark"` if dark-themed, and only `"system"` if the app itself uses system-based theme switching.

<anti-patterns>
- Do NOT browse/search the web for Neon Auth package exports or setup instructions.
- Do NOT import Neon Auth CSS files — the app's own styles should govern auth components.
- Do NOT leave auth pages unstyled or with minimal/default styling.
- Do NOT import `BetterAuthReactAdapter` from `@neondatabase/auth` — it is only exported from `@neondatabase/auth/react/adapters`.
</anti-patterns>

---

<nextjs-only>

## Path: Neon Auth API (Next.js)

For Next.js auth, use the current unified SDK surface.

<anti-patterns>
- Do NOT use `authApiHandler`
- Do NOT use `neonAuthMiddleware`
- Do NOT use `createAuthServer`
- Do NOT use stale Neon Auth v0.1 / Stack Auth patterns
</anti-patterns>

<code-template label="auth-server" file="lib/auth/server.ts" language="typescript">
import { createNeonAuth } from '@neondatabase/auth/next/server';

export const auth = createNeonAuth({
baseUrl: process.env.NEON_AUTH_BASE_URL!,
cookies: {
secret: process.env.NEON_AUTH_COOKIE_SECRET!,
},
});
</code-template>

<code-template label="auth-route-handler" file="app/api/auth/[...path]/route.ts" language="typescript">
import { auth } from '@/lib/auth/server';

export const { GET, POST } = auth.handler();
</code-template>

<code-template label="auth-client" file="lib/auth/client.ts" language="typescript">
'use client';

import { createAuthClient } from '@neondatabase/auth/next';

export const authClient = createAuthClient();
</code-template>

**Server Components that call `auth.getSession()` MUST export `dynamic = 'force-dynamic'`.**

<code-template label="auth-client-usage" file="components/UserMenu.tsx" language="tsx">
'use client';

import { authClient } from '@/lib/auth/client';

export function UserMenu() {
const { data: session } = authClient.useSession();

return session?.user ? (
<button onClick={() => authClient.signOut()}>
Sign out {session.user.name}
</button>
) : null;
}
</code-template>

<code-template label="auth-server-component" file="app/dashboard/page.tsx" language="typescript">
import { auth } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
const { data: session } = await auth.getSession();

if (!session?.user) {
return <div>Not authenticated</div>;
}

return <h1>Welcome, {session.user.name}</h1>;
}
</code-template>

## Path: Neon Auth UI (Next.js)

Use when the user wants prebuilt auth or account pages.

- Use `createAuthClient` from `@neondatabase/auth/next`.
- Do NOT use `createAuthClient('/api/auth')` in Next.js; use `createAuthClient()` with no arguments.
- **IMPORTANT**: Always style the sign-in and sign-up pages to be aesthetically pleasing and match the app's design system (colors, typography, spacing, border radius, shadows, focus states). Auth pages are the first thing users see — they must feel polished and premium. Use the project's existing styling approach. Never leave auth pages with default or unstyled appearance.

<anti-patterns>
- Do NOT use stale `@neondatabase/neon-js/auth/react/ui` Next.js examples.
</anti-patterns>

**IMPORTANT:** If the system prompt says email verification is enabled, do NOT use `AuthView` for the sign-up page — you must build a custom sign-up form instead (see the email verification guide). You may still use `AuthView` for the sign-in page.

<code-template label="auth-page" file="app/auth/[path]/page.tsx" language="tsx">
import { AuthView } from '@neondatabase/auth/react';
import './auth.css';

export const dynamicParams = false;

export default async function AuthPage({
params,
}: {
params: Promise<{ path: string }>;
}) {
const { path } = await params;

return <AuthView path={path} redirectTo="/" />;
}
</code-template>

<code-template label="root-layout-with-auth" file="app/layout.tsx" language="tsx">
import { authClient } from '@/lib/auth/client';
import { NeonAuthUIProvider, UserButton } from '@neondatabase/auth/react';

export default function RootLayout({
children,
}: {
children: React.ReactNode;
}) {
return (
{/* Set defaultTheme to match the app's theme: "light", "dark", or "system" if the app uses system-based switching */}
<NeonAuthUIProvider authClient={authClient} defaultTheme="light">
<header>
<UserButton />
</header>
{children}
</NeonAuthUIProvider>
);
}
</code-template>

### Environment Variables (`.env.local`)

<code-template label="env-vars" file=".env.local" language="bash">
# Neon Database (injected by Dyad)
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require

# Neon Auth (managed by Neon, values from Neon Console > Auth settings)

NEON_AUTH_BASE_URL=https://ep-xxx.neonauth.us-east-1.aws.neon.tech/neondb/auth
NEON_AUTH_COOKIE_SECRET=your-cookie-secret-here
</code-template>

</nextjs-only>

---

<vite-nitro-only>

## Path: Neon Auth (Vite + Nitro)

This project is a Vite SPA (React Router) with a Nitro server layer at `server/`. The Next.js entry point of `@neondatabase/auth` does not run outside Next.js, so the integration is a **hand-rolled reverse proxy**: the React app talks to `/api/auth/*`, and a Nitro catch-all forwards each request to `${NEON_AUTH_BASE_URL}/<path>`. The session cookie Neon issues rides through the proxy on every request.

<critical-rules>
- **must-not-import-next-server-entry**: Do NOT import from `@neondatabase/auth/next/server` (or any `@neondatabase/auth/next/*` subpath) in a Vite + Nitro project. That entry eagerly `import`s `next/headers` and `next/server`, so the server crashes at boot with `ERR_MODULE_NOT_FOUND: Cannot find package 'next'`. The integration goes through a hand-rolled proxy instead.
- **must-use-server-proxy**: The React app MUST call `/api/auth/*` (the Nitro proxy), NOT `NEON_AUTH_BASE_URL`. Do NOT pass `import.meta.env.VITE_NEON_AUTH_URL` (or any other Vite-prefixed Neon URL) to `createAuthClient`. Keep `NEON_AUTH_BASE_URL` server-only.
- **must-use-same-origin-baseURL**: When constructing `createAuthClient`, pass an **absolute URL pointing at the same origin** — e.g. `${window.location.origin}/api/auth`. Better Auth's `assertHasProtocol` validator throws `Invalid base URL: /api/auth` for bare paths (a relative `'/api/auth'` is rejected at runtime), so the protocol is required.
- **must-mount-catchall-route**: The Nitro proxy MUST be a catch-all so every Better Auth path (sign-in, sign-up, get-session, sign-out, callback, etc.) reaches the handler. Use `server/routes/api/auth/[...all].ts` — a single file. Do NOT hand-write per-endpoint files.
- **must-rewrite-secure-cookies-for-http-dev**: Neon Auth's session cookie is named `__Secure-neon-auth.session_token`. The browser enforces a hard rule: any cookie whose name starts with `__Secure-` or `__Host-` MUST carry the `Secure` attribute AND can only be set over HTTPS. The Vite dev server and Dyad preview run over plain HTTP, so the browser silently drops every session cookie — sign-in returns 200, the next `get-session` finds no cookie, and the user appears to never sign in. The proxy MUST therefore rewrite cookies in HTTP dev (see template below): on the way down rename `__Secure-` → `__Secure_` and `__Host-` → `__Host_`, strip `Secure`, strip `Partitioned`, strip `Domain=...`, and rewrite `SameSite=None` → `SameSite=Lax`; on the way up, undo the rename in the incoming `Cookie` header before forwarding upstream. Without this rewrite, sign-in is silently broken in every HTTP preview.
- **must-wire-react-router-into-provider**: `NeonAuthUIProvider` defaults its `navigate`/`replace`/`Link` to `window.location.href`, which causes a full page reload after sign-in/sign-up. The reload races the session cookie write and frequently leaves the user stuck on the auth page. You MUST pass `navigate`, `replace`, and `Link` from `react-router-dom` into `NeonAuthUIProvider`, AND pass `redirectTo="/"` (or the app's home route) on `<AuthView>`.
- **no-nitro-auto-imports-in-templates**: Always write explicit `import` statements in server code. Nitro's auto-import is opt-in and not enabled in the default Dyad scaffolding; relying on it will fail type-checking and (often) runtime.
- **must-avoid-regex-pitfalls-in-proxy**: Past LLM-generated proxies have repeatedly emitted broken regex literals like `/^/api/auth/` (the second `/` ends the regex; `api` becomes flags) or `/(^|;s*)/` (the `\s` got mangled to bare `s`). To prevent this, follow these rules in the proxy and session helper: (1) use `String.prototype.startsWith` + `slice` for the `/api/auth` prefix strip — do NOT use a regex; (2) for fixed-string substitutions like `__Secure_` ↔ `__Secure-`, `__Host_` ↔ `__Host-`, `; Secure`, `; Partitioned`, and `; SameSite=None` → `; SameSite=Lax`, use `String.prototype.replaceAll` with **string literals** — do NOT use regex; (3) the only place a regex is required is stripping `; Domain=<value>` from a `Set-Cookie`, where the value is variable. For that single regex, use `/;[ ]*Domain=[^;]*/gi` — note the literal-space character class `[ ]*` instead of `\s*` (resists `\s`-loss bugs), and no slashes inside the pattern.
</critical-rules>

<anti-patterns>
- Do NOT import `@neondatabase/auth/next/server` — it requires `next` and crashes in Nitro.
- Do NOT pass a bare path (`'/api/auth'`) to `createAuthClient`. Use `${window.location.origin}/api/auth`.
- Do NOT import `BetterAuthReactAdapter` from `@neondatabase/auth`. Use `@neondatabase/auth/react/adapters`.
- Do NOT call `auth.getSession({ headers })` from server code in a Vite + Nitro project — there is no `auth` instance to call. Read the session by fetching `${NEON_AUTH_BASE_URL}/get-session` directly with the user's cookie.
- Do NOT import `@neondatabase/serverless` (or any `@neondatabase/auth/next/*` server-only subpath) from any file under `src/`. The browser-safe entry points used by this guide — `@neondatabase/auth` (for `createAuthClient`), `@neondatabase/auth/react`, and `@neondatabase/auth/react/adapters` — ARE allowed in `src/` and are required by the templates below.
- Do NOT use `createAuthClient(import.meta.env.VITE_NEON_AUTH_URL)` — that exposes the auth URL in the client bundle and bypasses the proxy.
- Do NOT use Next.js patterns (`'use client'`, `next/navigation`, `app/auth/[path]/page.tsx`, server components, `dynamic = 'force-dynamic'`). This is a Vite + React Router project.
- Do NOT rely on `NEON_AUTH_COOKIE_SECRET` in this path. The cookie that holds the session is issued and signed by Neon Auth itself; the secret is only used by the Next.js `createNeonAuth` integration to sign an optional `session_data` cache cookie. The proxy approach does not need it.
</anti-patterns>

### Server: catch-all proxy

This is the heart of the integration. Create `server/routes/api/auth/[...all].ts` as a single catch-all that forwards every `/api/auth/*` request to `${NEON_AUTH_BASE_URL}/<path>`, undoing the cookie-name rewrite on the way up and applying it on the way down.

The handler must:

- Use `defineHandler` from `"nitro"` and the h3 utilities `getRequestHeaders`, `getRequestURL`, and `readRawBody` from `"nitro/h3"`. Read `process.env.NEON_AUTH_BASE_URL` at module scope.
- **Do not** use `event.request` — h3 in this Nitro version does not expose a Web `Request`. Use `getRequestURL(event)` for the URL and `event.method` for the HTTP method.
- Compute the upstream path by stripping the `/api/auth` prefix from `url.pathname` using `pathname.startsWith('/api/auth') ? pathname.slice('/api/auth'.length) || '/' : pathname` — **do NOT use a regex** (LLM-emitted regexes like `/^/api/auth/` are broken because the embedded `/` ends the literal). Then build the upstream URL as `${NEON_AUTH_BASE_URL}${upstreamPath}${url.search}`.
- Build `forwardedHeaders` (a `Headers` object) from `getRequestHeaders(event)`, skipping `host` and `content-length` and any `undefined` values. **On the way up**, restore upstream cookie names in the `cookie` header by calling `cookieHeader.replaceAll('__Secure_', '__Secure-').replaceAll('__Host_', '__Host-')` — string literals only, **no regex**. The `_` placeholder is unique enough that no false positive can occur in normal cookie values. If no cookie remains, delete the header.
- Read the body via `readRawBody(event, false)` (returns `Buffer`) for everything except `GET` and `HEAD`; pass it to `fetch` as `BodyInit`.
- `fetch` the upstream with `method`, `forwardedHeaders`, `body`, and `redirect: 'manual'`.
- Build the response `Headers` by copying every upstream header **except** `set-cookie`. For `set-cookie`, call `upstream.headers.getSetCookie?.() ?? []` to get the array (the standard `forEach` collapses duplicates).
- **HTTP dev cookie rewrite (way down)**: if `url.protocol === 'http:'`, rewrite each `Set-Cookie` string with the following exact sequence (string literals first, one regex only for the variable `Domain=` value):
  1. `c = c.replaceAll('__Secure-', '__Secure_').replaceAll('__Host-', '__Host_')` — restore the underscored placeholder so the browser will accept the cookie over HTTP.
  2. `c = c.replaceAll('; Secure', '').replaceAll(';Secure', '').replaceAll('; Partitioned', '').replaceAll(';Partitioned', '')` — fixed strings, **no regex**.
  3. `c = c.replace(/;[ ]*Domain=[^;]*/gi, '')` — the **only** required regex. Use the literal-space character class `[ ]*` (NOT `\s*`, which has been mangled to bare `s` by past LLM emissions) and no slashes inside the pattern.
  4. `c = c.replaceAll('; SameSite=None', '; SameSite=Lax').replaceAll(';SameSite=None', ';SameSite=Lax')` — fixed strings, **no regex**.
  Append each rewritten cookie to the response headers via `responseHeaders.append('set-cookie', c)`.
- Return `new Response(upstream.body, { status, statusText, headers: responseHeaders })` — stream the body through, do not buffer it.

### Server: shared session helper

Create `server/utils/session.ts` that reads the session directly from `${NEON_AUTH_BASE_URL}/get-session` using the user's cookie. There is no `auth` instance in this path — `createNeonAuth` would crash on import.

The module must:

- Read `process.env.NEON_AUTH_BASE_URL` at module scope.
- Export a `Session` type: `{ user: { id: string; name: string; email: string; emailVerified: boolean } } | null`.
- Export `getSessionFromCookie(cookieHeader: string | null): Promise<Session>` which:
  - Restores upstream cookie names in the input header by calling `cookieHeader.replaceAll('__Secure_', '__Secure-').replaceAll('__Host_', '__Host-')` — string literals only, **no regex** (same rewrite as the proxy uses on the way up). If no cookie, return `null`.
  - Calls `fetch(\`${NEON_AUTH_BASE_URL}/get-session\`, { headers: { cookie } })`.
  - Returns `null` on `!res.ok`. Otherwise parses JSON as `Session`; returns `null` if there is no `user`, otherwise returns the parsed session.

### Server: request-boundary middleware

Place this in `server/middleware/auth.ts` so Nitro auto-loads it. The middleware gates every `/api/*` request that is not itself an auth route and is not an SPA route.

It must:

- Import `defineHandler` from `"nitro"`, and `createError`, `getRequestHeader`, `getRequestURL` from `"nitro/h3"`. Import `getSessionFromCookie` from `../utils/session`.
- Define `PUBLIC_PREFIXES = ['/api/auth/', '/auth/']`.
- Read `pathname` from `getRequestURL(event)`. If it starts with any public prefix, `return` (allow). If it does not start with `/api/`, `return` (SPA routes are gated client-side).
- Read the cookie via `getRequestHeader(event, 'cookie') ?? null`, call `getSessionFromCookie`. If there is no `session?.user`, `throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })`. Otherwise stash `session.user.id` on `event.context.userId` for downstream handlers.

### Server: reading session inside Nitro handlers

For any protected route file (e.g. `server/routes/api/me.get.ts`):

- Import `defineHandler` from `"nitro"`, and `createError`, `getRequestHeader` from `"nitro/h3"`, and `getSessionFromCookie` from the session helper.
- In the handler, call `getSessionFromCookie(getRequestHeader(event, 'cookie') ?? null)`. Throw a 401 via `createError` if there is no `session?.user`. Otherwise return the data the route needs (e.g. `{ id, name }`).

(In practice the middleware has already enforced auth, so handlers can also read `event.context.userId` directly if they only need the id.)

### Client: auth client

Create `src/lib/auth-client.ts`.

- Import `createAuthClient` from `"@neondatabase/auth"` and `BetterAuthReactAdapter` from `"@neondatabase/auth/react/adapters"` (NOT from the root entry).
- Compute `baseURL` as an **absolute same-origin URL**: in the browser `${window.location.origin}/api/auth`; for SSR/build-time fall back to a placeholder absolute URL like `'http://localhost/api/auth'`. Do not pass a bare `'/api/auth'` — Better Auth's `assertHasProtocol` validator throws on relative paths.
- Export `authClient = createAuthClient(baseURL, { adapter: BetterAuthReactAdapter() })`.
- Export a typed `useAuthSession()` accessor: Neon's published types currently mistype `useSession` as a nanostores `Atom`, but at runtime it is the `better-auth/react` hook. Cast it through `unknown`: `(authClient.useSession as unknown as () => SessionState)()`, where `SessionState` is `{ data: { user: { id; name; email; emailVerified } } | null; isPending: boolean }`. Use `useAuthSession()` everywhere instead of `authClient.useSession()`.

### Client: provider with React Router wiring

`NeonAuthUIProvider`'s default `navigate`/`replace`/`Link` use `window.location.href`, which causes a full page reload after sign-in/sign-up that races the session cookie. Wire React Router in.

- **Router placement**: `AuthProvider` calls `useNavigate()`, so it must be rendered inside a `<BrowserRouter>`. **Check `src/App.tsx` first** — the Dyad scaffold already renders `<BrowserRouter>` there around its `<Routes>`. In that case, do NOT add a second `<BrowserRouter>` in `src/main.tsx` (React Router throws "You cannot render a `<Router>` inside another `<Router>`"); just reuse the existing one. Only if `App.tsx` has no `<BrowserRouter>` should you wrap `<App />` in `<BrowserRouter>` inside `src/main.tsx` (within `<StrictMode>`).
- **`src/components/AuthProvider.tsx`**: a wrapper component that imports `Link` and `useNavigate` from `react-router-dom`, `NeonAuthUIProvider` from `"@neondatabase/auth/react"`, and `authClient` from `@/lib/auth-client`. Inside, call `useNavigate()` and render `<NeonAuthUIProvider>` with these props:
  - `authClient={authClient}`
  - `defaultTheme="light"` (or `"dark"` / `"system"`) — **inspect the app's theme first** (Tailwind config, theme provider, `<html>` class) and pass the matching value. Do not leave it as the library default.
  - `navigate={(href) => navigate(href)}`
  - `replace={(href) => navigate(href, { replace: true })}`
  - `Link={({ href, ...props }) => <Link to={href} {...props} />}`
- **`src/pages/auth/AuthPage.tsx`**: read `path` from `useParams` (default `'sign-in'`), import `AuthView` from `"@neondatabase/auth/react"`, render `<AuthView path={path} redirectTo="/" />`. `redirectTo` is REQUIRED — without it the user gets stranded on the auth page after a successful sign-in. Also import a scoped `auth.css` for page-level styling (centered card, padding, branded colors); do NOT touch `globals.css`.
- **`src/App.tsx`**: place `<AuthProvider>` **inside** the existing `<BrowserRouter>` (it needs Router context for `useNavigate`) and wrap it around the header (with `<UserMenu />`) and the existing `<Routes>`. Add `<Route path="/auth/:path" element={<AuthPage />} />` to the existing `<Routes>` alongside the app's other routes. The `:path` param matches `AuthView`'s URL shape: `/auth/sign-in`, `/auth/sign-up`, `/auth/forgot-password`, `/auth/reset-password`.

**IMPORTANT:** If the system prompt says email verification is enabled, do NOT use `AuthView` for the sign-up page — you must build a custom sign-up form (see the email verification guide). You may still use `AuthView` for the sign-in page.

### Client: user menu

Prefer a small custom menu over `<UserButton />` for app-themed designs — `UserButton` is a heavy dropdown bundled with the auth UI library and styling it to match a non-default app design is non-trivial.

Create `src/components/UserMenu.tsx`:

- Import `authClient` and `useAuthSession` from `@/lib/auth-client`.
- Call `useAuthSession()`. Return `null` while `isPending`, return `null` if there is no `session?.user`.
- Render the user's name and a sign-out control wired to `authClient.signOut()`. Use the project's existing UI primitives (e.g. shadcn `DropdownMenu` if the project already has one).

If you do prefer the prebuilt `<UserButton />`, import it from `"@neondatabase/auth/react"` and pass `classNames` to align it with the app's design tokens; do NOT import the package's CSS.

### Environment Variables (`.env.local`)

`NEON_AUTH_BASE_URL` is the only required server-only var for this path. `NEON_AUTH_COOKIE_SECRET` is **not used** by the proxy path — it only matters for the Next.js `createNeonAuth` integration's optional `session_data` cache cookie. Never prefix either with `VITE_`.

The file should contain (server-only):

- `DATABASE_URL` — Neon Postgres connection string, injected by Dyad.
- `NEON_AUTH_BASE_URL` — copy from Neon Console → Auth settings (e.g. `https://ep-xxx.neonauth.us-east-1.aws.neon.tech/neondb/auth`).

</vite-nitro-only>
