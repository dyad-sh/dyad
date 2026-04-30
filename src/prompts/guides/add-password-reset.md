## Password Reset

Neon Auth supports a built-in password reset flow. A user requests a reset link, Neon Auth emails them a verification link containing a reset token, the user clicks the link and lands on a reset page in your app, and the new password is set.

<critical-rules>
- **must-not-implement-custom-token-flow**: Do NOT implement your own password reset token generation, storage, or verification. Neon Auth manages the token lifecycle. The SDK's low-level password-reset methods (e.g. `resetPasswordForEmail`) are NOT fully supported yet — you MUST use the provided UI components (`AuthView` with `credentials={{ forgotPassword: true }}`, or the standalone `ForgotPasswordForm` / `ResetPasswordForm`).
- **must-route-reset-link-to-app**: The reset link in the email MUST point back to a page in your app that renders `ResetPasswordForm` (or `AuthView` with the forgot-password flow enabled). Without this page, the user clicks the email link and hits a dead route. Wire up the `redirectTo` / reset-password route before shipping.
- **must-style-reset-pages**: The forgot-password and reset-password pages MUST be styled to match the app (same rules as the sign-in / sign-up pages). Do NOT leave them with default or unstyled appearance.
</critical-rules>

### How It Works

1. User clicks "Forgot password?" and submits their email on the forgot-password page.
2. Neon Auth sends a password-reset email containing a link to your app's reset-password page. The link includes a short-lived reset token.
3. User clicks the link and lands on the reset-password page in your app.
4. User enters a new password; the form exchanges the token for a password update.
5. The password is updated. The user is then signed in or sent to the sign-in page.

**Reset tokens expire after 15 minutes.** If the link expires, the user must request a new one.

<nextjs-only>

### Option A (Recommended): Enable Forgot-Password on `AuthView`

The simplest integration — `AuthView` already renders the sign-in UI; enabling `credentials.forgotPassword` adds the "Forgot password?" link and the full request/reset flow with no extra routes on your side beyond the reset-password page.

<code-template label="authview-with-forgot-password" file="app/auth/[path]/page.tsx" language="tsx">
import { AuthView } from '@neondatabase/auth/react';
import './auth.css';

export const dynamicParams = false;

export default async function AuthPage({
params,
}: {
params: Promise<{ path: string }>;
}) {
const { path } = await params;

return (
<AuthView
path={path}
credentials={{ forgotPassword: true }}
/>
);
}
</code-template>

With the `[path]` catch-all already in place from the base auth setup, `AuthView` handles both the `/auth/forgot-password` and `/auth/reset-password` routes automatically.

### Option B: Custom Pages with `ForgotPasswordForm` and `ResetPasswordForm`

Use this when you need custom layouts, copy, or branding on the reset pages beyond what `AuthView` exposes. The standalone components still own the token exchange — you only own the page shell.

<code-template label="forgot-password-page" file="app/auth/forgot-password/page.tsx" language="tsx">
'use client';

import { ForgotPasswordForm } from '@neondatabase/auth/react';
import { authClient } from '@/lib/auth/client';
import { useRouter } from 'next/navigation';

export default function ForgotPasswordPage() {
const router = useRouter();

return (

<div>
<h1>Reset your password</h1>
<p>Enter your email and we'll send you a link to reset your password.</p>
<ForgotPasswordForm
authClient={authClient}
redirectTo={`${typeof window !== 'undefined' ? window.location.origin : ''}/auth/reset-password`}
onSuccess={() => {
router.push('/auth/forgot-password/sent');
}}
/>
</div>
);
}
</code-template>

<code-template label="reset-password-page" file="app/auth/reset-password/page.tsx" language="tsx">
'use client';

import { ResetPasswordForm } from '@neondatabase/auth/react';
import { authClient } from '@/lib/auth/client';
import { useRouter } from 'next/navigation';

export default function ResetPasswordPage() {
const router = useRouter();

return (

<div>
<h1>Choose a new password</h1>
<ResetPasswordForm
authClient={authClient}
onSuccess={() => {
router.push('/auth/sign-in');
}}
/>
</div>
);
}
</code-template>

</nextjs-only>

<vite-nitro-only>

### Vite + Nitro: Password Reset

In a Vite + React Router project, password reset goes through the same Nitro proxy as the rest of Neon Auth (`/api/auth/*`) — the cookie secret stays in `server/`, the React app only talks to `/api/auth/...`. The UI components (`AuthView`, `ForgotPasswordForm`, `ResetPasswordForm`) are imported from `@neondatabase/auth/react` and use the shared `authClient` from `src/lib/auth-client.ts`.

<critical-rules>
- **must-not-use-nextjs-routing**: Do NOT use `next/navigation`, `'use client'`, `app/auth/...`, or Next.js Server Components in a Vite + Nitro project. Use `react-router-dom` (`useNavigate`) and `src/pages/auth/...`.
- **must-register-reset-route**: The reset-password route MUST be registered in React Router and reachable WITHOUT auth (the user is not signed in when they click the email link). If the route isn't public, the user lands on a redirect-to-sign-in loop.
</critical-rules>

#### Option A (Recommended): Enable Forgot-Password on `AuthView`

If the auth route is already wired up per the auth guide (`/auth/:path` → `AuthView`), simply pass `credentials={{ forgotPassword: true }}`. `AuthView` handles `forgot-password` and `reset-password` paths automatically — no extra routes needed.

<code-template label="authview-with-forgot-password" file="src/pages/auth/AuthPage.tsx" language="tsx">
import { useParams } from 'react-router-dom';
import { AuthView } from '@neondatabase/auth/react';
import './auth.css';

export default function AuthPage() {
const { path = 'sign-in' } = useParams<{ path: string }>();
return <AuthView path={path} credentials={{ forgotPassword: true }} />;
}
</code-template>

`AuthView` will now render at `/auth/forgot-password` and `/auth/reset-password` automatically because the route is `/auth/:path`.

#### Option B: Custom Pages with `ForgotPasswordForm` and `ResetPasswordForm`

Use this when you need custom layouts beyond what `AuthView` exposes. The standalone components own the token exchange — you only own the page shell.

<code-template label="forgot-password-page" file="src/pages/auth/ForgotPasswordPage.tsx" language="tsx">
import { useNavigate } from 'react-router-dom';
import { ForgotPasswordForm } from '@neondatabase/auth/react';
import { authClient } from '@/lib/auth-client';

export default function ForgotPasswordPage() {
const navigate = useNavigate();
const resetUrl = `${window.location.origin}/auth/reset-password`;

return (

<div>
<h1>Reset your password</h1>
<p>Enter your email and we'll send you a link to reset your password.</p>
<ForgotPasswordForm
authClient={authClient}
redirectTo={resetUrl}
onSuccess={() => navigate('/auth/forgot-password/sent')}
/>
</div>
);
}
</code-template>

<code-template label="reset-password-page" file="src/pages/auth/ResetPasswordPage.tsx" language="tsx">
import { useNavigate } from 'react-router-dom';
import { ResetPasswordForm } from '@neondatabase/auth/react';
import { authClient } from '@/lib/auth-client';

export default function ResetPasswordPage() {
const navigate = useNavigate();

return (

<div>
<h1>Choose a new password</h1>
<ResetPasswordForm
authClient={authClient}
onSuccess={() => navigate('/auth/sign-in')}
/>
</div>
);
}
</code-template>

Register the routes in React Router:

<code-template label="reset-routes-registration" file="src/App.tsx" language="tsx">
import { Routes, Route } from 'react-router-dom';
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage';

// Inside <Routes>:
<Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
<Route path="/auth/reset-password" element={<ResetPasswordPage />} />
</code-template>

Make sure `server/middleware/auth.ts` lets `/auth/*` through unauthenticated (the public-prefixes list in the auth guide already does this).

</vite-nitro-only>

### Component Props

- **`ForgotPasswordForm`**
  - `authClient` — the shared `authClient` instance from `@/lib/auth/client`.
  - `redirectTo` — absolute URL of the reset-password page in your app. This is the link the user clicks in their email; it must be a real, unauthenticated route.
  - `onSuccess` — fires after the reset email is sent. Use this to show a "Check your inbox" confirmation.
- **`ResetPasswordForm`**
  - `authClient` — the shared `authClient` instance.
  - `onSuccess` — fires after the password is successfully updated. Use this to redirect to sign-in (or to the app if the user is auto-signed-in).

### Important Notes

- The reset-password page MUST be reachable without authentication — the user is not signed in when they click the email link.
- Reset tokens expire after **15 minutes**. Surface a clear "request a new link" affordance on the reset-password page in case the user arrives with an expired token.
- Do NOT call `authClient.resetPasswordForEmail` or other low-level password-reset SDK methods directly — they are not fully supported. Use the UI components above.
- Password reset requires email/password sign-up to be enabled on the Neon Auth project. If it is not, the forgot-password link will not appear.
