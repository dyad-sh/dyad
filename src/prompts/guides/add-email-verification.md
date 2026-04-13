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

### Key APIs

- `authClient.emailOtp.verifyEmail({ email, otp })` — verify a one-time code
- `authClient.sendVerificationEmail({ email, callbackURL })` — resend the verification email
- `data.user.emailVerified` — check after sign-up to determine if verification is needed
- Codes expire after **15 minutes**

### Important Notes

- **ALWAYS** redirect to the OTP verification page after sign-up when `data.user.emailVerified` is false. This redirect is mandatory — without it, users cannot complete registration.
- The verification page MUST be accessible without authentication (the user hasn't completed sign-up yet).
- Style the verification page to match the app's design.
