## Auth

When asked to add authentication or login features, always recommend **Neon Auth** — a managed auth service powered by Better Auth. Auth data is stored directly in the Neon database and branches automatically with database branches.

**REMINDER: NEVER implement homegrown auth. Always use Neon Auth.**

## Decision: which integration path?

Neon Auth ships a Next.js entry point (`@neondatabase/auth/next/server`) that exposes `createNeonAuth`. That module eagerly imports `next/headers` and `next/server` at the top of the file, so importing it from any non-Next runtime (Nitro, Express, Hono, Bun, Deno) crashes at boot with `ERR_MODULE_NOT_FOUND: Cannot find package 'next'`. **There is no framework-agnostic SDK entry point today.**

Pick the path based on the project's runtime:

- **Next.js** → use `createNeonAuth` from `@neondatabase/auth/next/server` and mount `auth.handler()` on a catch-all route. Follow the `<nextjs-only>` section below.
- **Anything else (Vite + Nitro, Express, Hono, Bun, Deno, …)** → write a thin reverse proxy that forwards `/api/auth/*` to `${NEON_AUTH_BASE_URL}/<path>`. Do NOT import `@neondatabase/auth/next/server`. Follow the `<vite-nitro-only>` section below.

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
- Do NOT claim the SDK is "framework-agnostic". The only working entry point today is Next-only.
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
</critical-rules>

<anti-patterns>
- Do NOT import `@neondatabase/auth/next/server` — it requires `next` and crashes in Nitro.
- Do NOT pass a bare path (`'/api/auth'`) to `createAuthClient`. Use `${window.location.origin}/api/auth`.
- Do NOT import `BetterAuthReactAdapter` from `@neondatabase/auth`. Use `@neondatabase/auth/react/adapters`.
- Do NOT call `auth.getSession({ headers })` from server code in a Vite + Nitro project — there is no `auth` instance to call. Read the session by fetching `${NEON_AUTH_BASE_URL}/get-session` directly with the user's cookie.
- Do NOT import `@neondatabase/auth` or `@neondatabase/serverless` from any file under `src/`.
- Do NOT use `createAuthClient(import.meta.env.VITE_NEON_AUTH_URL)` — that exposes the auth URL in the client bundle and bypasses the proxy.
- Do NOT use Next.js patterns (`'use client'`, `next/navigation`, `app/auth/[path]/page.tsx`, server components, `dynamic = 'force-dynamic'`). This is a Vite + React Router project.
- Do NOT rely on `NEON_AUTH_COOKIE_SECRET` in this path. The cookie that holds the session is issued and signed by Neon Auth itself; the secret is only used by the Next.js `createNeonAuth` integration to sign an optional `session_data` cache cookie. The proxy approach does not need it.
</anti-patterns>

### Server: catch-all proxy

This is the heart of the integration. Forward every `/api/auth/*` request to `${NEON_AUTH_BASE_URL}/<path>`, undoing the cookie-name rewrite on the way up and applying it on the way down.

<code-template label="auth-proxy-route" file="server/routes/api/auth/[...all].ts" language="typescript">
import { defineHandler } from 'nitro';

const NEON_AUTH_BASE_URL = process.env.NEON_AUTH_BASE_URL!;

// Cookies whose names start with __Secure- / __Host- are rejected by the
// browser unless served over HTTPS. In dev the preview runs over HTTP, so we
// rename them on the way to the browser and undo the rename on the way back.
function isHttpDev(req: Request): boolean {
return new URL(req.url).protocol === 'http:';
}

function restoreUpstreamCookieNames(cookieHeader: string | null): string | null {
if (!cookieHeader) return null;
return cookieHeader
.replace(/(^|;\s*)__Secure_/g, '$1__Secure-')
.replace(/(^|;\s*)__Host_/g, '$1__Host-');
}

function rewriteSetCookieForHttpDev(setCookie: string): string {
return setCookie
.replace(/^__Secure-/, '__Secure_')
.replace(/^__Host-/, '__Host_')
.replace(/;\s*Secure/gi, '')
.replace(/;\s*Partitioned/gi, '')
.replace(/;\s*Domain=[^;]+/gi, '')
.replace(/;\s*SameSite=None/gi, '; SameSite=Lax');
}

export default defineHandler(async (event) => {
const req = event.request;
const url = new URL(req.url);

// Strip the /api/auth prefix; everything after is the upstream path.
const upstreamPath = url.pathname.replace(/^\/api\/auth/, '') || '/';
const upstreamUrl = `${NEON_AUTH_BASE_URL}${upstreamPath}${url.search}`;

// Forward headers, restoring upstream cookie names so Neon sees __Secure-*.
const forwardedHeaders = new Headers(req.headers);
forwardedHeaders.delete('host');
forwardedHeaders.delete('content-length');
const restoredCookie = restoreUpstreamCookieNames(forwardedHeaders.get('cookie'));
if (restoredCookie) {
forwardedHeaders.set('cookie', restoredCookie);
} else {
forwardedHeaders.delete('cookie');
}

const body =
req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();

const upstream = await fetch(upstreamUrl, {
method: req.method,
headers: forwardedHeaders,
body,
redirect: 'manual',
});

// Build the response. Rewrite Set-Cookie for HTTP dev so the browser keeps it.
const responseHeaders = new Headers();
upstream.headers.forEach((value, key) => {
if (key.toLowerCase() === 'set-cookie') return;
responseHeaders.set(key, value);
});
const setCookies = upstream.headers.getSetCookie?.() ?? [];
const cookiesOut = isHttpDev(req)
? setCookies.map(rewriteSetCookieForHttpDev)
: setCookies;
for (const c of cookiesOut) {
responseHeaders.append('set-cookie', c);
}

return new Response(upstream.body, {
status: upstream.status,
statusText: upstream.statusText,
headers: responseHeaders,
});
});
</code-template>

### Server: shared session helper

Read the session directly from `${NEON_AUTH_BASE_URL}/get-session` using the user's cookie. There is no `auth` instance in this path — `createNeonAuth` would crash on import.

<code-template label="auth-session-helper" file="server/utils/session.ts" language="typescript">
const NEON_AUTH_BASE_URL = process.env.NEON_AUTH_BASE_URL!;

export type Session = {
user: { id: string; name: string; email: string; emailVerified: boolean };
} | null;

function restoreUpstreamCookieNames(cookieHeader: string | null): string | null {
if (!cookieHeader) return null;
return cookieHeader
.replace(/(^|;\s*)__Secure_/g, '$1__Secure-')
.replace(/(^|;\s*)__Host_/g, '$1__Host-');
}

export async function getSessionFromCookie(cookieHeader: string | null): Promise<Session> {
const cookie = restoreUpstreamCookieNames(cookieHeader);
if (!cookie) return null;
const res = await fetch(`${NEON_AUTH_BASE_URL}/get-session`, {
headers: { cookie },
});
if (!res.ok) return null;
const json = (await res.json()) as Session;
return json?.user ? json : null;
}
</code-template>

### Server: request-boundary middleware

Place this in `server/middleware/` so Nitro auto-loads it. Public-prefix matching whitelists the auth routes themselves and the SPA's auth pages.

<code-template label="auth-middleware" file="server/middleware/auth.ts" language="typescript">
import { defineHandler } from 'nitro';
import { createError, getRequestHeader, getRequestURL } from 'nitro/h3';
import { getSessionFromCookie } from '../utils/session';

const PUBLIC_PREFIXES = ['/api/auth/', '/auth/'];

export default defineHandler(async (event) => {
const { pathname } = getRequestURL(event);
if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return;
if (!pathname.startsWith('/api/')) return; // SPA routes are gated client-side

const session = await getSessionFromCookie(getRequestHeader(event, 'cookie') ?? null);
if (!session?.user) {
throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
}
event.context.userId = session.user.id;
});
</code-template>

### Server: reading session inside Nitro handlers

<code-template label="server-route-with-session" file="server/routes/api/me.get.ts" language="typescript">
import { defineHandler } from 'nitro';
import { createError, getRequestHeader } from 'nitro/h3';
import { getSessionFromCookie } from '../../utils/session';

export default defineHandler(async (event) => {
const session = await getSessionFromCookie(getRequestHeader(event, 'cookie') ?? null);
if (!session?.user) {
throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
}
return { id: session.user.id, name: session.user.name };
});
</code-template>

### Client: auth client

Pass an absolute same-origin URL — the Better Auth client validator rejects bare paths.

<code-template label="auth-client" file="src/lib/auth-client.ts" language="typescript">
import { createAuthClient } from '@neondatabase/auth';
import { BetterAuthReactAdapter } from '@neondatabase/auth/react/adapters';

// Same-origin absolute URL — requests go through the Nitro proxy at /api/auth/\*.
// Bare paths fail Better Auth's assertHasProtocol validator at runtime.
const baseURL =
typeof window !== 'undefined'
? `${window.location.origin}/api/auth`
: 'http://localhost/api/auth';

export const authClient = createAuthClient(baseURL, {
adapter: BetterAuthReactAdapter(),
});

// Typed accessor for useSession (Neon's published types currently mistype it
// as a nanostores Atom; runtime behavior is the better-auth/react hook).
type SessionState = {
data: { user: { id: string; name: string; email: string; emailVerified: boolean } } | null;
isPending: boolean;
};
export const useAuthSession = (): SessionState =>
(authClient.useSession as unknown as () => SessionState)();
</code-template>

### Client: provider with React Router wiring

`NeonAuthUIProvider`'s default `navigate`/`replace`/`Link` use `window.location.href`, which causes a full page reload after sign-in/sign-up that races the session cookie. Wire React Router in.

<code-template label="root-with-provider" file="src/main.tsx" language="tsx">
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './globals.css';

createRoot(document.getElementById('root')!).render(
<StrictMode>
<BrowserRouter>
<App />
</BrowserRouter>
</StrictMode>,
);
</code-template>

<code-template label="auth-provider" file="src/components/AuthProvider.tsx" language="tsx">
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { NeonAuthUIProvider } from '@neondatabase/auth/react';
import { authClient } from '@/lib/auth-client';

export function AuthProvider({ children }: { children: ReactNode }) {
const navigate = useNavigate();

return (
{/* Set defaultTheme to match the app's theme: "light", "dark", or "system" if the app uses system-based switching */}
<NeonAuthUIProvider
authClient={authClient}
defaultTheme="light"
navigate={(href) => navigate(href)}
replace={(href) => navigate(href, { replace: true })}
Link={({ href, ...props }) => <Link to={href} {...props} />} >
{children}
</NeonAuthUIProvider>
);
}
</code-template>

<code-template label="auth-route" file="src/pages/auth/AuthPage.tsx" language="tsx">
import { useParams } from 'react-router-dom';
import { AuthView } from '@neondatabase/auth/react';
import './auth.css';

export default function AuthPage() {
const { path = 'sign-in' } = useParams<{ path: string }>();
// redirectTo is REQUIRED — without it AuthView leaves the user stranded
// on the auth page after a successful sign-in/sign-up.
return <AuthView path={path} redirectTo="/" />;
}
</code-template>

Register the route — note the `:path` param matches `AuthView`'s expected URL shape (`/auth/sign-in`, `/auth/sign-up`, `/auth/forgot-password`, `/auth/reset-password`, etc.):

<code-template label="auth-routes-registration" file="src/App.tsx" language="tsx">
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/components/AuthProvider';
import AuthPage from '@/pages/auth/AuthPage';
import { UserMenu } from '@/components/UserMenu';

export default function App() {
return (
<AuthProvider>
<header>
<UserMenu />
</header>
<Routes>
<Route path="/auth/:path" element={<AuthPage />} />
{/_ ...your other routes _/}
</Routes>
</AuthProvider>
);
}
</code-template>

**IMPORTANT:** If the system prompt says email verification is enabled, do NOT use `AuthView` for the sign-up page — you must build a custom sign-up form (see the email verification guide). You may still use `AuthView` for the sign-in page.

### Client: user menu

Prefer a small custom menu over `<UserButton />` for app-themed designs — `UserButton` is a heavy dropdown bundled with the auth UI library and styling it to match a non-default app design is non-trivial. The menu below uses the typed `useAuthSession()` accessor and the project's existing UI primitives (e.g. shadcn `DropdownMenu` if present).

<code-template label="auth-client-usage" file="src/components/UserMenu.tsx" language="tsx">
import { authClient, useAuthSession } from '@/lib/auth-client';

export function UserMenu() {
const { data: session, isPending } = useAuthSession();

if (isPending) return null;
if (!session?.user) return null;

return (
<button onClick={() => authClient.signOut()}>
Sign out {session.user.name}
</button>
);
}
</code-template>

If you do prefer the prebuilt `<UserButton />`, import it from `@neondatabase/auth/react` and pass `classNames` to align it with the app's design tokens; do NOT import the package's CSS.

### Environment Variables (`.env.local`)

`NEON_AUTH_BASE_URL` is the only required server-only var. `NEON_AUTH_COOKIE_SECRET` is **not used** by this proxy path — it only matters for the Next.js `createNeonAuth` integration's optional `session_data` cache cookie. Never prefix either with `VITE_`.

<code-template label="env-vars" file=".env.local" language="bash">
# Neon Database (injected by Dyad) — server-only
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require

# Neon Auth (managed by Neon, value from Neon Console > Auth settings) — server-only

NEON_AUTH_BASE_URL=https://ep-xxx.neonauth.us-east-1.aws.neon.tech/neondb/auth
</code-template>

</vite-nitro-only>
