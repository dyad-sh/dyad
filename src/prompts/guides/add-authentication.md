## Auth

When asked to add authentication or login features, always recommend **Neon Auth** — a managed auth service powered by Better Auth. Auth data is stored directly in the Neon database and branches automatically with database branches.

**REMINDER: NEVER implement homegrown auth. Always use Neon Auth.**

## Neon Auth SDK API Rules

- `useSession` is NOT a standalone import from `@neondatabase/auth`. Call `authClient.useSession()` on the client instance.
- `signOut` is a top-level method on `authClient`. Use `authClient.signOut()`, NOT `authClient.auth.signOut()`.
- In server code, call `auth.getSession()` with no `{ headers }` argument unless using a documented option such as `query`.

## Auth UI Guidelines

**Do NOT use Neon Auth's default styles.** Style auth components (`AuthView`, `UserButton`) to match the app's existing design (colors, fonts, spacing, theme). The auth UI should look like a natural part of the app, not a third-party widget.

<critical-rules>
- **must-style-auth-pages**: You MUST style the sign-in and sign-up pages. Do NOT skip this step. Use whatever styling approach the project already uses (Tailwind, CSS modules, styled-components, plain CSS, etc.). The auth pages should have polished, app-consistent styling including: centered card layout, proper spacing/padding, styled form inputs, branded colors, hover/focus states, and responsive design. Unstyled or default-styled auth pages are a hard failure.
- **must-be-aesthetically-pleasing**: The auth UI MUST be aesthetically pleasing. Auth pages are the first impression users have of the app — they must feel polished and premium, not like an afterthought. Go beyond basic styling: use subtle gradients or background accents, smooth transitions, clear visual hierarchy, well-sized and well-spaced inputs, and appealing button styles. The auth experience should look like it was designed with care, matching the quality level of a professionally designed app.
- **must-not-alter-existing-styles**: Adding auth MUST NOT change the styling of any existing pages or components. This is a hard rule. Do NOT modify global CSS, shared layout styles, Tailwind config, theme variables, or any styles that affect non-auth pages. Auth integration must be purely additive — only add new auth pages/components and their scoped styles. If existing pages look different after adding auth, you have broken this rule. Scope all auth-related styles strictly to auth pages and components (e.g., use CSS modules, scoped class names, or file-level styles like app/auth/auth.css). Never touch globals.css, root layout styles, or shared component styles unless the user explicitly asks for it.
</critical-rules>

- Use `@neondatabase/auth/react` as the default UI import path for `NeonAuthUIProvider`, `AuthView`, and `UserButton`.
- Keep `NeonAuthUIProvider`, `AuthView`, and `UserButton` imported from the same module path.
- If the app already has a working Neon Auth UI import path, reuse it instead of changing it.
- **must-set-defaultTheme**: `NeonAuthUIProvider` defaults to `defaultTheme="system"`, which can override the app's theme (e.g., applying dark mode styles when the app uses light mode, or vice versa). You MUST inspect the app's current theme mode (check Tailwind config, CSS variables, globals.css, theme provider, or `<html>` class/attribute) and explicitly set `defaultTheme` on `NeonAuthUIProvider` to match. Use `"light"` if the app is light-themed, `"dark"` if dark-themed, and only `"system"` if the app itself uses system-based theme switching.

<anti-patterns>
- Do NOT browse/search the web for Neon Auth package exports or setup instructions.
- Do NOT import Neon Auth CSS files — the app's own styles should govern auth components.
- Do NOT leave auth pages unstyled or with minimal/default styling.
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

return <AuthView path={path} />;
}
</code-template>

<code-template label="root-layout-with-auth" file="app/layout.tsx" language="tsx">
import { authClient } from '@/lib/auth/client';
import {
  NeonAuthUIProvider,
  UserButton,
} from '@neondatabase/auth/react';

export default function RootLayout({
children,
}: {
children: React.ReactNode;
}) {
return (
{/_ Set defaultTheme to match the app's theme: "light", "dark", or "system" if the app uses system-based switching _/}
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
