export function getNeonAvailableSystemPrompt(
  neonClientCode: string,
  frameworkType: "nextjs" | "vite" | "other" | null,
  options?: { emailVerificationEnabled?: boolean },
): string {
  const sharedPrompt = getSharedNeonPrompt(neonClientCode);

  if (frameworkType === "nextjs") {
    return (
      sharedPrompt +
      getNextJsNeonPrompt() +
      (options?.emailVerificationEnabled ? getEmailVerificationPrompt() : "")
    );
  }

  return sharedPrompt + getGenericNeonPrompt();
}

function getSharedNeonPrompt(neonClientCode: string): string {
  return `
# Neon Database Instructions

The user has Neon available for their app, so use it for database, auth, and backend functionality when it fits the request.

## Start by Inspecting the App

Before scaffolding anything:
- Check whether the project already has a database module, auth module, App Router structure, Tailwind setup, and provider wrappers.
- Reuse the project's existing paths and conventions when they already exist.
- Only fall back to the default snippets below when the project does not already have an equivalent module.

## Neon Client Setup

Check if a Neon database client already exists in the project. If it does not, create one with this code:
\`\`\`typescript
${neonClientCode}
\`\`\`

## Auth

When asked to add authentication or login features, always recommend **Neon Auth** — a managed auth service powered by Better Auth. Auth data is stored directly in the Neon database and branches automatically with database branches.

**IMPORTANT: NEVER implement homegrown auth with JWT + bcrypt or any other custom auth solution. Always use Neon Auth.**

## Database

**IMPORTANT: Always use the execute SQL tool to run schema changes against the Neon database. NEVER write SQL migration files manually.**

- Use \`<dyad-execute-sql>\` for schema changes.
- Keep the app's queries, types, and schema files synchronized with the SQL you execute through Dyad.
- Prefer tagged \`sql\`...\`\` queries or Drizzle over string-built SQL.

## Authorization and RLS

Do not assume every Neon app should use the same authorization pattern.

- If the app uses a plain \`DATABASE_URL\` serverless connection in server-only code, authorization lives in server code and SQL filters.
- Only use Postgres RLS policies that rely on Neon Auth identity helpers such as \`auth.user_id()\` when the app is explicitly using Neon Data API, authenticated URLs, or another JWT-backed RLS flow.
- Never claim that \`auth.user_id()\`-based RLS works automatically with a plain \`DATABASE_URL\` connection.
- If you do implement RLS, create complete policies for the required operations and explain why the app needs database-enforced authorization.

### Empty Database First-Run Guidance

When the database has no tables yet:
1. Determine what data the feature needs to store
2. Create the schema with the execute SQL tool
3. Generate the matching server code, UI, and auth wiring
`;
}

function getNextJsNeonPrompt(): string {
  return `
## Next.js Instructions

Treat Neon integration as a short decision tree:
1. Inspect the project for an existing database module, auth modules, App Router structure, Tailwind setup, provider wrappers, and an existing request-boundary file.
2. Reuse those modules and conventions if they exist. Do not create duplicate database clients, auth clients, or duplicate request-boundary files.
3. If the user only needs server-side database access, use the DB-only path below.
4. If the user needs auth APIs or sessions, use the Neon Auth API path below.
5. If the user wants prebuilt auth or account pages, extend the Neon Auth API path with the UI path below.

### Critical Security Rules

**NEVER place \`DATABASE_URL\` in client-side code.**
**NEVER import \`@neondatabase/serverless\` in React components or browser code.**

The \`DATABASE_URL\` connection string gives full read/write database access. It must stay in:
- Next.js Route Handlers under \`app/api/\`
- Next.js Server Actions
- Next.js Server Components
- Environment variables (\`.env.local\` in Dyad-generated Next.js apps)

When you build queries:
- Prefer tagged \`sql\`...\`\` queries or Drizzle over string-built SQL.
- Filter by the authenticated user in server code when the app uses a plain \`DATABASE_URL\` connection.
- Keep any Drizzle schema or app types synchronized with the SQL executed through Dyad.

### Default Packages

Treat the package guidance in this prompt as the default source of truth for Neon work in Next.js.
- If the request needs Neon Auth and \`@neondatabase/auth\` is not already listed in \`package.json\`, install \`@neondatabase/auth\` directly before writing code.
- Do not use web search to figure out which Neon Auth package to install or which import surface to start from.

Start with the minimum packages needed for the requested path:
- \`@neondatabase/serverless\` for server-side database access
- \`@neondatabase/auth\` for Neon Auth in Next.js
- Only mention \`@neondatabase/neon-js\` when the implementation explicitly needs Neon Data API or other neon-js-only APIs

### DB-Only Path

If the request is about database access without auth UI:
- Reuse the server-side Neon client module shown above when no equivalent module already exists.
- Use that client only in server code.
- If the app already uses Drizzle, reuse it instead of replacing it with raw SQL.

Example route handler:
\`\`\`typescript
import { sql } from '@/db';

export async function GET() {
  const todos = await sql\`SELECT * FROM todos ORDER BY created_at DESC\`;
  return Response.json(todos);
}
\`\`\`

### Neon Auth API Path

For Next.js auth, use the current unified SDK surface and avoid legacy APIs such as \`authApiHandler\`, \`neonAuthMiddleware\`, \`createAuthServer\`, or stale Neon Auth v0.1 / Stack Auth patterns.

If the project does not already list \`@neondatabase/auth\`, install it directly before wiring auth. Use the API surface below instead of searching the web for setup snippets.

\`lib/auth/server.ts\`

\`\`\`typescript
import { createNeonAuth } from '@neondatabase/auth/next/server';

export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET!,
  },
});
\`\`\`

\`app/api/auth/[...path]/route.ts\`

\`\`\`typescript
import { auth } from '@/lib/auth/server';

export const { GET, POST } = auth.handler();
\`\`\`

\`lib/auth/client.ts\`

\`\`\`typescript
'use client';

import { createAuthClient } from '@neondatabase/auth/next';

export const authClient = createAuthClient();
\`\`\`

Important API rules:
- \`useSession\` is not a standalone import from \`@neondatabase/auth/next\`; call \`authClient.useSession()\` on the client instance.
- \`signOut\` is a top-level method on \`authClient\`; use \`authClient.signOut()\`, not \`authClient.auth.signOut()\`.
- In Next.js server code, call \`auth.getSession()\` with no \`{ headers }\` argument unless you are intentionally using a documented option such as \`query\`.

Client usage example:
\`\`\`tsx
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
\`\`\`

Use \`auth.getSession()\` in Server Components, Server Actions, and Route Handlers. Server Components that call \`auth.getSession()\` should export \`dynamic = 'force-dynamic'\`.

\`\`\`typescript
import { auth } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { data: session } = await auth.getSession();

  if (!session?.user) {
    return <div>Not authenticated</div>;
  }

  return <h1>Welcome, {session.user.name}</h1>;
}
\`\`\`

### Request-Boundary File

Protect routes with \`auth.middleware(...)\`, but reuse the project's existing request-boundary file:
- Current Neon quickstarts use \`proxy.ts\`
- Older Next.js apps may already use \`middleware.ts\`
- Reuse whichever file the app already has and do not create both

\`\`\`typescript
import { auth } from '@/lib/auth/server';

export default auth.middleware({
  loginUrl: '/auth/sign-in',
});
\`\`\`

### Neon Auth UI Path

If the user wants prebuilt auth or account pages, use the current UI package surface:
- Install \`@neondatabase/auth\` directly if it is missing.
- \`createAuthClient\` from \`@neondatabase/auth/next\`
- Do not use \`createAuthClient('/api/auth')\` in Next.js; use \`createAuthClient()\`
- Use \`@neondatabase/auth/react\` as the default UI import path for \`NeonAuthUIProvider\`, \`AuthView\`, and \`UserButton\`.
- Keep \`NeonAuthUIProvider\`, \`AuthView\`, and \`UserButton\` imported from the same module path.
- If the app already has a working Neon Auth UI import path, reuse it instead of changing it.
- Do not browse/search the web for Neon Auth package exports or setup instructions.
- Do not use stale \`@neondatabase/neon-js/auth/react/ui\` Next.js examples.

#### Styling Auth Components

**Do NOT use Neon Auth's default styles.** Style auth components (AuthView, UserButton) to match the app's existing design (colors, fonts, spacing, theme). The auth UI should look like a natural part of the app, not a third-party widget. Do not import Neon Auth CSS files — the app's own styles should govern auth components.

\`app/auth/[path]/page.tsx\`
\`\`\`tsx
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
\`\`\`

\`app/layout.tsx\`
\`\`\`tsx
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
    <NeonAuthUIProvider authClient={authClient}>
      <header>
        <UserButton />
      </header>
      {children}
    </NeonAuthUIProvider>
  );
}
\`\`\`

### Environment Variables (\`.env.local\`)

\`\`\`bash
# Neon Database (injected by Dyad)
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require

# Neon Auth (managed by Neon, values from Neon Console > Auth settings)
NEON_AUTH_BASE_URL=https://ep-xxx.neonauth.us-east-1.aws.neon.tech/neondb/auth
NEON_AUTH_COOKIE_SECRET=your-cookie-secret-here
\`\`\`
`;
}

function getGenericNeonPrompt(): string {
  return `
## Generic Database Instructions

Use the Neon serverless driver to connect:

\`\`\`typescript
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const result = await sql\`SELECT * FROM table_name\`;
\`\`\`

Add the \`@neondatabase/serverless\` dependency to the project.

### Environment Variables

\`\`\`bash
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require
\`\`\`
`;
}

function getEmailVerificationPrompt(): string {
  return `
## Email Verification

Email verification is **enabled** on this Neon Auth branch. When users sign up, they must verify their email before they can sign in.

### How It Works

1. User signs up with email and password.
2. Neon Auth automatically sends a verification email with a one-time code (OTP).
3. The user enters the OTP on a verification page in your app.
4. Once verified, the user can sign in.

### Implementation Guide

**After sign-up, check \`emailVerified\` to redirect to verification:**

\`\`\`tsx
const handleSignUp = async (email: string, password: string, name: string) => {
  const { data, error } = await authClient.signUp.email({
    email,
    password,
    name,
  });

  if (error) {
    // Handle error
    return;
  }

  if (data?.user && !data.user.emailVerified) {
    // Redirect to verification page
    router.push(\`/auth/verify-email?email=\${encodeURIComponent(email)}\`);
  }
};
\`\`\`

### Verification Page

Create a verification page where users enter the OTP code:

\`\`\`tsx
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
        callbackURL: pathname,
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
\`\`\`

### Key APIs

- \`authClient.emailOtp.verifyEmail({ email, otp })\` — verify a one-time code
- \`authClient.sendVerificationEmail({ email, callbackURL })\` — resend the verification email
- Check \`data.user.emailVerified\` after sign-up to determine if verification is needed
- Codes expire after **15 minutes**

### Important Notes

- Always check \`data.user.emailVerified\` after sign-up to determine if verification is needed.
- The verification page should be accessible without authentication (the user hasn't completed sign-up yet).
- Style the verification page to match the app's design.
`;
}

export const NEON_NOT_AVAILABLE_SYSTEM_PROMPT = `
If the user wants to use Neon or do something that requires a database, auth, or backend functionality,
tell them that they need to add Neon to their app.

The following response will show a button that allows the user to add Neon to their app.

<dyad-add-integration provider="neon"></dyad-add-integration>

# Examples

## Example 1: User wants to use a database

### User prompt

I want to add a database to my app.

### Assistant response

You need to first add Neon to your app.

<dyad-add-integration provider="neon"></dyad-add-integration>

## Example 2: User wants to add auth to their app

### User prompt

I want to add auth to my app.

### Assistant response

You need to first add Neon to your app and then we can add auth using Neon Auth.

<dyad-add-integration provider="neon"></dyad-add-integration>
`;
