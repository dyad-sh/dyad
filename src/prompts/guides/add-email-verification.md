## Email Verification

Email verification is **enabled** on this Neon Auth branch. When users sign up, they must verify their email before they can sign in.

<critical-rules>
- **must-not-use-authview-for-signup**: Do NOT use the `AuthView` component for the sign-up page. `AuthView` is a prebuilt component that does not expose a callback after sign-up, so you CANNOT redirect the user to the OTP verification page. You MUST implement a custom sign-up form that calls `authClient.signUp.email()` directly. You may still use `AuthView` for the sign-in page.
- **must-redirect-to-otp-page**: After a successful sign-up, you MUST immediately redirect the user to the OTP verification page. This is NOT optional. The sign-up flow is incomplete without this redirect — users will be stuck if they are not taken to the verification page. Always check `data.user.emailVerified` after sign-up and redirect to `/auth/verify-email?email=...` when it is false. Never leave the user on the sign-up page after a successful registration when email verification is enabled.
</critical-rules>

### How It Works

1. User signs up with email and password.
2. Neon Auth automatically sends a verification email with a one-time code (OTP).
3. The app **immediately redirects** the user to the OTP verification page.
4. The user enters the OTP on the verification page.
5. Once verified, the user can sign in.

### Implementation Guide

**The sign-up page MUST be a custom form — do NOT use `AuthView` for sign-up.** `AuthView` does not provide a post-sign-up callback, so it is impossible to redirect to the verification page. Build a custom sign-up form that calls `authClient.signUp.email()` directly, checks `emailVerified`, and redirects.

<nextjs-only>

<code-template label="custom-signup-page" file="app/auth/sign-up/page.tsx" language="tsx">
'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth/client';
import { useRouter } from 'next/navigation';

export default function SignUpPage() {
const [name, setName] = useState('');
const [email, setEmail] = useState('');
const [password, setPassword] = useState('');
const [error, setError] = useState('');
const [isLoading, setIsLoading] = useState(false);
const router = useRouter();

const handleSignUp = async (e: React.FormEvent) => {
e.preventDefault();
setIsLoading(true);
setError('');

    try {
      const { data, error } = await authClient.signUp.email({
        email,
        password,
        name,
      });

      if (error) {
        setError(error.message ?? 'Sign-up failed.');
        return;
      }

      if (data?.user && !data.user.emailVerified) {
        // MUST redirect to verification page
        router.push(`/auth/verify-email?email=${encodeURIComponent(email)}`);
      }
    } catch (err: any) {
      setError(err?.message || 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }

};

return (

<div>
<h1>Create an account</h1>
<form onSubmit={handleSignUp}>
<input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required />
{error && <p>{error}</p>}
<button type="submit" disabled={isLoading}>
{isLoading ? 'Signing up...' : 'Sign Up'}
</button>
</form>
<p>Already have an account? <a href="/auth/sign-in">Sign in</a></p>
</div>
);
}
</code-template>

### Verification Page

Create a verification page where users enter the OTP code:

<code-template label="verify-email-page" file="app/auth/verify-email/page.tsx" language="tsx">
'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth/client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

export default function VerifyEmailPage() {
const [otp, setOtp] = useState('');
const [message, setMessage] = useState('');
const [isVerifying, setIsVerifying] = useState(false);
const router = useRouter();
const pathname = usePathname();

const searchParams = useSearchParams();
const email = searchParams.get('email') ?? '';

const handleVerify = async (e: React.FormEvent) => {
e.preventDefault();
setIsVerifying(true);
setMessage('');

    try {
      const { data, error } = await authClient.emailOtp.verifyEmail({
        email,
        otp,
      });

      if (error) throw error;

      if (data?.session) {
        router.push('/dashboard');
      } else {
        setMessage('Email verified! You can now sign in.');
        router.push('/auth/sign-in');
      }
    } catch (err: any) {
      setMessage(err?.message || 'Invalid or expired verification code.');
    } finally {
      setIsVerifying(false);
    }

};

const handleResend = async () => {
try {
const { error } = await authClient.sendVerificationEmail({
email,
callbackURL: `${pathname}?email=${encodeURIComponent(email)}`,
});
if (error) throw error;
setMessage('Verification email resent! Check your inbox.');
} catch (err: any) {
setMessage(err?.message || 'Failed to resend verification email.');
}
};

return (

<div>
<h1>Verify your email</h1>
<p>Enter the verification code sent to {email}</p>
<form onSubmit={handleVerify}>
<input
type="text"
value={otp}
onChange={(e) => setOtp(e.target.value)}
placeholder="Enter verification code"
required
/>
{message && <p>{message}</p>}
<button type="submit" disabled={isVerifying}>
{isVerifying ? 'Verifying...' : 'Verify Email'}
</button>
</form>
<button onClick={handleResend}>
Resend verification code
</button>
<p>Verification codes expire after 15 minutes.</p>
</div>
);
}
</code-template>

</nextjs-only>

<vite-nitro-only>

### Vite + Nitro: Custom Sign-Up + OTP Verification

In a Vite + React Router project, the sign-up and verify-email pages live under `src/pages/auth/` and use `useNavigate` / `useSearchParams` from `react-router-dom`. Both pages call `authClient` from `@/lib/auth-client` (same client used everywhere — talks to the Nitro proxy at `/api/auth/*`).

<critical-rules>
- **must-not-use-nextjs-routing**: Do NOT use `next/navigation`, `'use client'`, `app/auth/...`, or Next.js Server Components in a Vite + Nitro project. Use `react-router-dom` and `src/pages/auth/...`.
- **must-register-public-routes**: The sign-up and verify-email routes MUST be reachable WITHOUT auth. The auth-middleware's public-prefix list (covering `/auth/*`) already handles this — don't tighten it.
</critical-rules>

#### Custom sign-up page

Create `src/pages/auth/SignUpPage.tsx`.

- Imports: `useState` from `'react'`, `useNavigate` from `'react-router-dom'`, `authClient` from `'@/lib/auth-client'`.
- Local state: `name`, `email`, `password`, `error`, `isLoading`. Get `navigate` from `useNavigate()`.
- Submit handler: `e.preventDefault()`, set `isLoading`, clear `error`, then `await authClient.signUp.email({ email, password, name })`. If the response has an `error`, show its `message ?? 'Sign-up failed.'` and bail. Wrap in try/catch for unexpected errors. Always reset `isLoading` in `finally`.
- **Critical redirect**: when the response has `data?.user && !data.user.emailVerified`, immediately call `navigate(\`/auth/verify-email?email=${encodeURIComponent(email)}\`)`. This redirect is mandatory — without it, the user is stranded on the sign-up page and the flow is incomplete.
- Render an accessible form (name, email, password inputs all `required`), an error message when `error` is set, a submit button that disables and shows a "Signing up…" label while `isLoading`, and a link to `/auth/sign-in` for users who already have an account.
- Style the page to match the app (same rules as the rest of the auth UI). Use a scoped `auth.css` if the auth pages already share one — do NOT touch `globals.css`.

#### OTP verification page

Create `src/pages/auth/VerifyEmailPage.tsx`.

- Imports: `useState` from `'react'`, `useNavigate`, `useSearchParams`, `useLocation` from `'react-router-dom'`, `authClient` from `'@/lib/auth-client'`.
- Local state: `otp`, `message`, `isVerifying`. Get `navigate` from `useNavigate()`, `location` from `useLocation()`, `[searchParams]` from `useSearchParams()`. Read `email = searchParams.get('email') ?? ''`.
- Verify handler: `await authClient.emailOtp.verifyEmail({ email, otp })`. If the response has an `error`, throw it. If `data?.session` exists, the user is signed in — navigate to the app's home/dashboard. Otherwise show "Email verified! You can now sign in." and navigate to `/auth/sign-in`. On thrown errors, surface `err?.message` (fall back to "Invalid or expired verification code."). Always clear `isVerifying` in `finally`.
- Resend handler: `await authClient.sendVerificationEmail({ email, callbackURL: \`${location.pathname}?email=${encodeURIComponent(email)}\` })`. Throw on error; on success show "Verification email resent! Check your inbox."
- Render: heading, a line showing the email being verified, a form with a single text input for the OTP (`required`), the `message` line when set, a submit button that disables and shows "Verifying…" while `isVerifying`, a separate "Resend verification code" button wired to the resend handler, and a note that codes expire after 15 minutes.

#### Register the routes

In `src/App.tsx`, add two routes inside the existing `<Routes>` block: `<Route path="/auth/sign-up" element={<SignUpPage />} />` and `<Route path="/auth/verify-email" element={<VerifyEmailPage />} />`. Both must be reachable without authentication — the auth middleware's `/auth/*` public prefix already covers this; do NOT tighten it.

If the project still has the generic `/auth/:path` route (from the base auth guide) rendering `AuthView`, keep it for sign-in but ensure `/auth/sign-up` is a more specific route registered **before** the catch-all so React Router prefers your custom page over `AuthView` for sign-up.

</vite-nitro-only>

### Key APIs

- `authClient.emailOtp.verifyEmail({ email, otp })` — verify a one-time code
- `authClient.sendVerificationEmail({ email, callbackURL })` — resend the verification email
- `data.user.emailVerified` — check after sign-up to determine if verification is needed
- Codes expire after **15 minutes**

### Important Notes

- **ALWAYS** redirect to the OTP verification page after sign-up when `data.user.emailVerified` is false. This redirect is mandatory — without it, users cannot complete registration.
- The verification page MUST be accessible without authentication (the user hasn't completed sign-up yet).
- Style the verification page to match the app's design.
