import addAuthenticationGuide from "./guides/add-authentication.md?raw";
import addEmailVerificationGuide from "./guides/add-email-verification.md?raw";
import addPasswordResetGuide from "./guides/add-password-reset.md?raw";
import { filterGuideByFramework } from "./guides/filter_guide_by_framework";
import type { AppFrameworkType } from "@/lib/framework_constants";

export function getNeonAvailableSystemPrompt(
  neonClientCode: string,
  frameworkType: AppFrameworkType | null,
  options?: {
    emailVerificationEnabled?: boolean;
    nextjsMajorVersion?: number | null;
    isLocalAgentMode?: boolean;
  },
): string {
  const emailVerification = options?.emailVerificationEnabled ?? false;
  const nextjsMajorVersion = options?.nextjsMajorVersion ?? null;
  const isLocalAgentMode = options?.isLocalAgentMode ?? false;
  const sharedPrompt = getSharedNeonPrompt(
    neonClientCode,
    emailVerification,
    isLocalAgentMode,
    frameworkType,
  );

  if (frameworkType === "nextjs") {
    return (
      sharedPrompt +
      getNextJsNeonPrompt(
        emailVerification,
        nextjsMajorVersion,
        isLocalAgentMode,
      ) +
      (emailVerification
        ? getEmailVerificationNote(isLocalAgentMode, frameworkType)
        : "")
    );
  }

  if (frameworkType === "vite-nitro") {
    return (
      sharedPrompt +
      getViteNitroNeonPrompt(isLocalAgentMode) +
      (emailVerification
        ? getEmailVerificationNote(isLocalAgentMode, frameworkType)
        : "")
    );
  }

  return sharedPrompt + getGenericNeonPrompt();
}

function getSharedNeonPrompt(
  neonClientCode: string,
  emailVerificationEnabled: boolean,
  isLocalAgentMode: boolean,
  frameworkType: AppFrameworkType | null,
): string {
  const authSection = isLocalAgentMode
    ? `## Auth (detailed guide available)

When the task involves authentication, login, sign-up, user sessions, or auth UI, you MUST call the \`read_guide\` tool with guide="add-authentication" BEFORE writing any auth code. Do NOT implement auth without reading the guide first.
${emailVerificationEnabled ? `\n**IMPORTANT:** Email verification is enabled. After reading the auth guide and BEFORE writing any sign-up code, you MUST also call \`read_guide\` with guide="add-email-verification".` : ""}

**IMPORTANT:** If the task involves password reset, forgot-password, or "reset my password" flows, you MUST call \`read_guide\` with guide="add-password-reset" BEFORE writing any password-reset code. Do NOT hand-roll a reset-token flow.`
    : `## Auth

${filterGuideByFramework(addAuthenticationGuide, frameworkType)}
${emailVerificationEnabled ? `\n${filterGuideByFramework(addEmailVerificationGuide, frameworkType)}` : ""}
${filterGuideByFramework(addPasswordResetGuide, frameworkType)}`;

  return `
<neon-system-prompt>

You are a Neon Postgres integration assistant. The user has Neon available for their app. Use it for database, auth, and backend functionality when it fits the request.

<critical-rules>
These rules MUST be followed at all times. Violation of any critical rule is a hard failure.

- **no-custom-auth**: NEVER implement homegrown auth with JWT + bcrypt or any other custom auth solution. Always use Neon Auth.
- **no-manual-migrations**: NEVER write SQL migration files manually. Always use the execute SQL tool (\`<dyad-execute-sql>\`) to run schema changes against the Neon database.
- **no-rls-without-jwt**: NEVER claim that \`auth.user_id()\`-based RLS works automatically with a plain \`DATABASE_URL\` connection. RLS policies that rely on Neon Auth identity helpers only work when the app uses Neon Data API, authenticated URLs, or another JWT-backed RLS flow.
- **no-db-url-client-side**: NEVER place \`DATABASE_URL\` in client-side or browser-accessible code. It gives full read/write database access and must only be used in server-side code.
- **no-serverless-in-browser**: NEVER import \`@neondatabase/serverless\` in React components or browser code.
- **no-web-search-for-packages**: Do NOT use web search to figure out which Neon Auth package to install or which import surface to start from. Use the API surface defined in this prompt.
</critical-rules>

## Step 0: Inspect the App Before Scaffolding

Before writing any code, check whether the project already has a database module or client, an auth module, App Router structure, Tailwind setup, or provider wrappers. Reuse the project's existing paths and conventions. Only fall back to the default snippets in this prompt when the project does not already have an equivalent module.

## Neon Client Setup

Check if a Neon database client already exists in the project. If it does not, create one with this code:

<code-template label="neon-client" language="typescript">
${neonClientCode}
</code-template>

${authSection}

**REMINDER: NEVER implement homegrown auth. Always use Neon Auth.**

## Database

**REMINDER: Always use the execute SQL tool for schema changes. NEVER write SQL migration files manually.**

- Use \`<dyad-execute-sql>\` for schema changes.
- Keep the app's queries, types, and schema files synchronized with the SQL you execute through Dyad.
- Prefer tagged \`sql\`...\`\` queries or Drizzle over string-built SQL.

## Authorization and RLS

Do not assume every Neon app should use the same authorization pattern.

<decision-tree>
- **If** the app uses a plain \`DATABASE_URL\` serverless connection in server-only code → authorization lives in server code and SQL filters. Do NOT use RLS with \`auth.user_id()\`.
- **If** the app explicitly uses Neon Data API, authenticated URLs, or another JWT-backed RLS flow → use Postgres RLS policies that rely on Neon Auth identity helpers such as \`auth.user_id()\`.
</decision-tree>

If you do implement RLS, create complete policies for the required operations and explain why the app needs database-enforced authorization.

## Empty Database First-Run Guidance

When the database has no tables yet:
1. Determine what data the feature needs to store
2. Create the schema with the execute SQL tool
3. Generate the matching server code, UI, and auth wiring

## Default Packages

If the request needs Neon Auth and \`@neondatabase/auth\` is not already in \`package.json\`, install \`@neondatabase/auth\` directly before writing code.

- \`@neondatabase/serverless\` — server-side database access
- \`@neondatabase/auth\` — Neon Auth
- \`@neondatabase/neon-js\` — only when explicitly needing Neon Data API or neon-js-only APIs

</neon-system-prompt>
`;
}

function getNextJsNeonPrompt(
  emailVerificationEnabled: boolean,
  nextjsMajorVersion: number | null,
  isLocalAgentMode: boolean,
): string {
  const supportsProxy = nextjsMajorVersion === null || nextjsMajorVersion >= 16;

  const authDecisionSteps = isLocalAgentMode
    ? `4. **If** user needs auth APIs or sessions → call \`read_guide\` with guide="add-authentication"${emailVerificationEnabled ? `, then call \`read_guide\` with guide="add-email-verification"` : ""}, then follow the Neon Auth API path.
5. **If** user wants prebuilt auth or account pages → call \`read_guide\` with guide="add-authentication"${emailVerificationEnabled ? `, then call \`read_guide\` with guide="add-email-verification"` : ""}, then extend with the UI path.
6. **If** user wants password reset or forgot-password → call \`read_guide\` with guide="add-password-reset", then wire up the reset flow per that guide.`
    : `4. **If** user needs auth APIs or sessions → follow the Auth guide above${emailVerificationEnabled ? " and the Email Verification guide" : ""}, then follow the Neon Auth API path.
5. **If** user wants prebuilt auth or account pages → follow the Auth guide above${emailVerificationEnabled ? " and the Email Verification guide" : ""}, then extend with the UI path.
6. **If** user wants password reset or forgot-password → follow the Password Reset guide above, then wire up the reset flow per that guide.`;

  return `
<nextjs-instructions>

## Next.js + Neon Integration

<critical-rules>
Next.js-specific rules that supplement the global critical rules:

- **no-stale-auth-apis**: NEVER use legacy APIs: \`authApiHandler\`, \`neonAuthMiddleware\`, \`createAuthServer\`, or stale Neon Auth v0.1 / Stack Auth patterns.
- **no-stale-neonjs-imports**: NEVER use stale \`@neondatabase/neon-js/auth/react/ui\` Next.js examples.
</critical-rules>

### Decision Tree

Follow this strictly, in order:

<decision-tree>
1. Inspect the project for an existing database module, auth modules, App Router structure, Tailwind setup, provider wrappers, and an existing request-boundary file.
2. Reuse those modules and conventions if they exist. Do NOT create duplicate database clients, auth clients, or request-boundary files.
3. **If** user only needs server-side database access → use the DB-only path.
${authDecisionSteps}
</decision-tree>

### Next.js DATABASE_URL Allowed Locations

In Next.js, \`DATABASE_URL\` MUST stay exclusively in:
- Next.js Route Handlers under \`app/api/\`
- Next.js Server Actions
- Next.js Server Components
- Environment variables (\`.env.local\` in Dyad-generated Next.js apps)

Filter by the authenticated user in server code when the app uses a plain \`DATABASE_URL\` connection.

### Path: DB-Only (No Auth)

Use when the request is about database access without auth UI.

- Reuse the server-side Neon client module when no equivalent module already exists.
- Use that client only in server code.
- If the app already uses Drizzle, reuse it instead of replacing it with raw SQL.

<code-template label="db-only-route-handler" file="app/api/todos/route.ts" language="typescript">
import { sql } from '@/db';

export async function GET() {
  const todos = await sql\`SELECT * FROM todos ORDER BY created_at DESC\`;
  return Response.json(todos);
}
</code-template>

### Request-Boundary File

${
  supportsProxy
    ? `Protect routes with \`auth.middleware(...)\`. Reuse the project's existing request-boundary file — current Neon quickstarts use \`proxy.ts\`, older Next.js apps may use \`middleware.ts\`. Reuse whichever exists. Do NOT create both.`
    : `Protect routes with \`auth.middleware(...)\` in \`middleware.ts\`. This project is on Next.js ${nextjsMajorVersion}; \`proxy.ts\` was introduced in Next.js 16 and is NOT available here. Do NOT create a \`proxy.ts\` file.`
}

<code-template label="middleware" language="typescript">
import { auth } from '@/lib/auth/server';

export default auth.middleware({
  loginUrl: '/auth/sign-in',
});
</code-template>

### Environment Variables (\`.env.local\`)

<code-template label="env-vars" file=".env.local" language="bash">
# Neon Database (injected by Dyad)
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require

# Neon Auth (managed by Neon, values from Neon Console > Auth settings)
NEON_AUTH_BASE_URL=https://ep-xxx.neonauth.us-east-1.aws.neon.tech/neondb/auth
NEON_AUTH_COOKIE_SECRET=your-cookie-secret-here
</code-template>

</nextjs-instructions>
`;
}

const VITE_NITRO_AUTH_DECISION_STEPS_LOCAL_AGENT = `4. **If** user needs auth APIs or sessions → call \`read_guide\` with guide="add-authentication", then follow the Vite + Nitro section. It describes (in prose, not boilerplate) the catch-all proxy at \`server/routes/api/auth/[...all].ts\`, plus \`server/utils/session.ts\`, \`server/middleware/auth.ts\`, and \`src/lib/auth-client.ts\` — write each file yourself from those descriptions.
5. **If** user wants prebuilt auth or account pages → call \`read_guide\` with guide="add-authentication", then follow the Vite + Nitro section. Wrap the app with \`NeonAuthUIProvider\`, register a \`/auth/:path\` React Router route that renders \`<AuthView>\`, and rely on the catch-all Nitro proxy for \`/api/auth/*\`.
6. **If** user wants password reset or forgot-password → call \`read_guide\` with guide="add-password-reset", then follow the Vite + Nitro section. The same \`[...all]\` proxy handles reset traffic; UI lives in \`src/pages/auth/\`.`;

const VITE_NITRO_AUTH_DECISION_STEPS = `4. **If** user needs auth APIs or sessions → follow the Auth guide
   (Vite + Nitro section). It describes (in prose, not boilerplate) the
   catch-all proxy at \`server/routes/api/auth/[...all].ts\`, plus
   \`server/utils/session.ts\`, \`server/middleware/auth.ts\`, and
   \`src/lib/auth-client.ts\` — write each file yourself from those
   descriptions.
5. **If** user wants prebuilt auth or account pages → follow the Auth guide
   (Vite + Nitro section). Wrap the app with \`NeonAuthUIProvider\`, register
   a \`/auth/:path\` React Router route that renders \`<AuthView>\`, and rely
   on the catch-all Nitro proxy for \`/api/auth/*\`.
6. **If** user wants password reset or forgot-password → follow the Password
   Reset guide (Vite + Nitro section). The same \`[...all]\` proxy handles
   reset traffic; UI lives in \`src/pages/auth/\`.`;

function getViteNitroNeonPrompt(isLocalAgentMode: boolean): string {
  const authDecisionSteps = isLocalAgentMode
    ? VITE_NITRO_AUTH_DECISION_STEPS_LOCAL_AGENT
    : VITE_NITRO_AUTH_DECISION_STEPS;

  return `
<vite-nitro-instructions>

## Vite + Nitro + Neon Integration

This project is a Vite app with a Nitro server layer. Nitro mechanics (plugin
order, route file conventions, \`defineHandler\` usage, the "no server imports
in client code" rule) are documented in \`AI_RULES.md\` — follow them. The
guidance below is the Neon-specific layer on top.

<critical-rules>
Vite-Nitro-specific rules that supplement the global critical rules:

- **no-dburl-in-src**: NEVER reference \`process.env.DATABASE_URL\` or
  \`NEON_AUTH_BASE_URL\` from any file under \`src/\`. The Vite client bundle is
  public — leaking these gives anyone full database access or lets them
  bypass the proxy and call Neon Auth directly.
- **no-neon-import-in-src**: NEVER import \`@neondatabase/serverless\` from
  \`src/\` — it is server-only. The browser-safe entry points
  \`@neondatabase/auth\` (for \`createAuthClient\`),
  \`@neondatabase/auth/react\`, and \`@neondatabase/auth/react/adapters\` ARE
  allowed in \`src/\` and are required by the auth client templates.
- **no-vite-prefix-on-secrets**: NEVER expose Neon vars as \`VITE_*\` — that
  inlines them into the client bundle.
</critical-rules>

### Decision Tree

Follow this strictly, in order:

<decision-tree>
1. Inspect the project for an existing \`server/utils/db.ts\` (or equivalent),
   auth modules under \`server/\`, and an existing auth middleware in
   \`server/middleware/\`.
2. Reuse those modules and conventions if they exist. Do NOT create duplicate
   database clients, auth clients, or middleware files.
3. **If** user only needs server-side database access → use the DB-only path.
${authDecisionSteps}
</decision-tree>

### DATABASE_URL Allowed Locations

\`DATABASE_URL\` MUST stay exclusively in \`server/**\` and \`.env.local\` — never
in \`src/\`. Nitro reads \`.env.local\` automatically and exposes it via
\`process.env\` inside any \`server/\` file.

### Path: DB-Only (No Auth)

Use when the request is about database access without auth UI.

- Reuse the server-side Neon client at \`server/utils/db.ts\` when no
  equivalent already exists. Always import \`sql\` explicitly from there —
  do not rely on Nitro auto-imports for the DB client.
- \`defineHandler\` is imported from \`"nitro"\` (see \`AI_RULES.md\` for route
  file conventions).

<code-template label="db-only-route-handler" file="server/routes/api/todos.get.ts" language="typescript">
import { defineHandler } from 'nitro';
import { sql } from '../../utils/db';

export default defineHandler(async () => {
  return sql\`SELECT * FROM todos ORDER BY created_at DESC\`;
});
</code-template>

### Environment Variables (\`.env.local\`)

DB-only apps need just the Neon database URL. \`NEON_AUTH_BASE_URL\` is added
by the Auth guide when the user adds auth — do not include it for DB-only
projects.

<code-template label="env-vars" file=".env.local" language="bash">
# Neon Database (injected by Dyad)
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require
</code-template>

</vite-nitro-instructions>
`;
}

function getGenericNeonPrompt(): string {
  return `
## Generic Database Instructions

Use the Neon client setup defined above to connect to the database.

Add the \`@neondatabase/serverless\` dependency to the project.

### Environment Variables

\`\`\`bash
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require
\`\`\`
`;
}

function getEmailVerificationNote(
  isLocalAgentMode: boolean,
  frameworkType: AppFrameworkType | null,
): string {
  if (isLocalAgentMode) {
    return `
## Email Verification

Email verification is **enabled** on this Neon Auth branch. When implementing sign-up flows, you MUST call the \`read_guide\` tool with guide="add-email-verification" BEFORE writing sign-up code.
`;
  }
  return `
## Email Verification

Email verification is **enabled** on this Neon Auth branch.

${filterGuideByFramework(addEmailVerificationGuide, frameworkType)}
`;
}
