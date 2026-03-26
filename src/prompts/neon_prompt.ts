export function getNeonAvailableSystemPrompt(
  neonClientCode: string,
  frameworkType: "nextjs" | "vite" | "other" | null,
): string {
  const sharedPrompt = getSharedNeonPrompt(neonClientCode);

  if (frameworkType === "nextjs") {
    return sharedPrompt + getNextJsNeonPrompt();
  }

  if (frameworkType === "vite") {
    return sharedPrompt + getViteNeonPrompt();
  }

  return sharedPrompt + getGenericNeonPrompt();
}

function getSharedNeonPrompt(neonClientCode: string): string {
  return `
# Neon Database Instructions

The user has Neon available for their app so use it for any database, auth or backend functionality.

## Neon Client Setup

Check if a Neon database client already exists in the project.

**If it doesn't exist**, create the client file with this code:
\`\`\`typescript
${neonClientCode}
\`\`\`

## Auth

When asked to add authentication or login features, always recommend **Neon Auth** — a managed auth service powered by Better Auth. Auth data is stored directly in the Neon database and branches automatically with database branches.

**IMPORTANT: NEVER implement homegrown auth with JWT + bcrypt or any other custom auth solution. Always use Neon Auth.**

## Database

**IMPORTANT: Always use the execute SQL tool to run SQL queries against the Neon database. NEVER write SQL migration files manually.**

You will need to set up the database schema using the execute SQL tool.

### Row Level Security (RLS)

**SECURITY WARNING: ALWAYS ENABLE RLS ON ALL TABLES**

Row Level Security (RLS) is MANDATORY for all tables. Without RLS policies, ANY user can read, insert, update, or delete ANY data in your database.

#### RLS Best Practices (REQUIRED):

1. **Enable RLS on Every Table:**
\`\`\`sql
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;
\`\`\`

2. **Create Appropriate Policies for Each Operation:**
   - SELECT policies (who can read data)
   - INSERT policies (who can create data)
   - UPDATE policies (who can modify data)
   - DELETE policies (who can remove data)

3. **Common RLS Policy Patterns:**

   **User-specific Data Access (default — use this unless told otherwise):**
\`\`\`sql
CREATE POLICY "crud-authenticated-policy-select"
  ON table_name AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ((select auth.user_id() = table_name.user_id));

CREATE POLICY "crud-authenticated-policy-insert"
  ON table_name AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK ((select auth.user_id() = table_name.user_id));

CREATE POLICY "crud-authenticated-policy-update"
  ON table_name AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING ((select auth.user_id() = table_name.user_id));

CREATE POLICY "crud-authenticated-policy-delete"
  ON table_name AS PERMISSIVE FOR DELETE TO "authenticated"
  USING ((select auth.user_id() = table_name.user_id));
\`\`\`

   **Public Read Access (ONLY USE IF SPECIFICALLY REQUESTED):**
\`\`\`sql
CREATE POLICY "Public read access" ON table_name FOR SELECT USING (true);
\`\`\`

#### RLS Policy Creation Template:

When creating any table, ALWAYS follow this pattern:

\`\`\`sql
-- Create table
CREATE TABLE table_name (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  -- other columns
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS (REQUIRED)
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

-- Create policies for each operation
CREATE POLICY "crud-authenticated-policy-select"
  ON table_name AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ((select auth.user_id() = table_name.user_id));

CREATE POLICY "crud-authenticated-policy-insert"
  ON table_name AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK ((select auth.user_id() = table_name.user_id));

CREATE POLICY "crud-authenticated-policy-update"
  ON table_name AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING ((select auth.user_id() = table_name.user_id));

CREATE POLICY "crud-authenticated-policy-delete"
  ON table_name AS PERMISSIVE FOR DELETE TO "authenticated"
  USING ((select auth.user_id() = table_name.user_id));
\`\`\`

**REMINDER: Without proper RLS policies, your database is completely exposed to unauthorized access.**

### Empty Database First-Run Guidance

When the database has no tables yet:
1. Ask the user what data they need to store
2. Create the schema with proper RLS policies
3. Generate the client code and UI components

### Migration Patterns

- Use \`<dyad-execute-sql>\` tags for all schema changes
- Always include RLS policies with table creation
- Use \`IF NOT EXISTS\` where appropriate for idempotent migrations
`;
}

function getNextJsNeonPrompt(): string {
  return `
## Next.js-Specific Instructions

### CRITICAL SECURITY RULE

**NEVER place \`DATABASE_URL\` in client-side code.**
**NEVER import \`@neondatabase/serverless\` in React components or browser code.**

The \`DATABASE_URL\` connection string gives full read/write database access. It MUST only be used in:
- Next.js API routes (\`app/api/\`)
- Next.js Server Actions
- Next.js Server Components
- Environment variables (\`.env.local\`, NOT \`.env\`)

### Dependencies

Add these dependencies to the project:
- \`@neondatabase/serverless\` — serverless Postgres driver
- \`drizzle-orm\` — type-safe ORM
- \`drizzle-kit\` — migrations toolkit
- \`@neondatabase/auth\` — Neon Auth server SDK for Next.js
- \`@neondatabase/neon-js\` — Neon Auth client SDK (provides \`auth\`, \`auth/react/ui\`)

### Drizzle ORM Setup

Create the database client at \`src/db/index.ts\`:
\`\`\`typescript
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });
\`\`\`

Define schemas at \`src/db/schema.ts\` using Drizzle's \`pgTable\`.

### API Route Pattern

\`\`\`typescript
import { db } from '@/db';
import { todos } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth/server';
import { headers } from 'next/headers';

export async function GET() {
  const session = await auth.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userTodos = await db.select().from(todos).where(eq(todos.userId, session.user.id));
  return Response.json(userTodos);
}
\`\`\`

### Auth Server Configuration (\`lib/auth/server.ts\`)

\`\`\`typescript
import { createNeonAuth } from '@neondatabase/auth/next/server';

export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET! },
});
\`\`\`

### Auth Route Handler (\`app/api/auth/[...path]/route.ts\`)

\`\`\`typescript
import { auth } from '@/lib/auth/server';
export const { GET, POST } = auth.handler();
\`\`\`

### Client-Side Auth (\`src/lib/auth-client.ts\`)

\`\`\`typescript
import { createAuthClient } from '@neondatabase/neon-js/auth';
export const authClient = createAuthClient('/api/auth');
// Provides: useSession(), signIn.email(), signOut(), etc.
\`\`\`

### Auth UI Components

When building auth pages (sign-in, sign-up), **always style them to match the application's existing theme and design**. For sign-up pages, use \`<AuthView pathname="sign-up" />\`.

\`\`\`tsx
import { NeonAuthUIProvider, AuthView } from '@neondatabase/neon-js/auth/react/ui';
import { authClient } from '@/lib/auth-client';

export default function AuthPage() {
  return (
    <NeonAuthUIProvider authClient={authClient}>
      <AuthView pathname="sign-in" />
    </NeonAuthUIProvider>
  );
}
\`\`\`

### Environment Variables (\`.env.local\`)

\`\`\`bash
# Neon Database (injected by Dyad)
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require

# Neon Auth (managed by Neon, values from Neon Console > Auth settings)
NEON_AUTH_BASE_URL=https://auth.neon.tech/...
NEON_AUTH_COOKIE_SECRET=your-cookie-secret-here
\`\`\`
`;
}

function getViteNeonPrompt(): string {
  return `
## React/Vite-Specific Instructions

### CRITICAL SECURITY RULE

**NEVER use \`DATABASE_URL\` or \`@neondatabase/serverless\` in React/Vite apps.**

React/Vite apps use the **Neon Data API** — a managed REST proxy that validates JWT tokens from Neon Auth and enforces PostgreSQL Row-Level Security (RLS). This eliminates the need for a server layer or exposed connection strings.

**ALWAYS use the Data API via \`@neondatabase/neon-js\` for all database queries.**
**ALWAYS configure RLS policies with \`TO "authenticated"\` role on ALL tables.**
**ALWAYS authenticate via Neon Auth before making Data API requests.**

### Dependencies

Add these dependencies to the project:
- \`@neondatabase/neon-js\` — unified client SDK (provides \`createClient\` for Data API queries, \`BetterAuthReactAdapter\` for auth, and \`auth/react/ui\` for pre-built components)
- \`drizzle-orm\` — type-safe ORM (optional)

### Neon Client Setup (\`src/lib/auth.ts\`)

\`\`\`typescript
import { createClient } from '@neondatabase/neon-js';
import { BetterAuthReactAdapter } from '@neondatabase/neon-js/auth/react/adapters';
import type { Database } from '../../types/database';

export const client = createClient<Database>({
  auth: {
    adapter: BetterAuthReactAdapter(),
    url: import.meta.env.VITE_NEON_AUTH_URL,
  },
  dataApi: {
    url: import.meta.env.VITE_NEON_DATA_API_URL,
  },
});
\`\`\`

### Data API Query Patterns (PostgREST-compatible)

\`\`\`typescript
// SELECT
const { data } = await client.from('todos').select('id, title, completed, created_at').order('created_at', { ascending: false });

// INSERT with select-back
const { data } = await client.from('todos').insert({ title: newTitle }).select('id, title, completed, created_at').single();

// UPDATE
const { error } = await client.from('todos').update({ completed: true }).eq('id', todoId);

// DELETE
const { error } = await client.from('todos').delete().eq('id', todoId);
\`\`\`

### Auth Patterns

Auth is handled via the \`BetterAuthReactAdapter\` configured in the client:

\`\`\`typescript
// Sign up
await client.auth.signUp.email({ name: 'User', email, password });

// Sign in
await client.auth.signIn.email({ email, password });

// Sign out
await client.auth.signOut();
\`\`\`

### Auth UI Components

When building auth pages (sign-in, sign-up), **always style them to match the application's existing theme and design**. For sign-up pages, use \`<AuthView pathname="sign-up" />\`.

\`\`\`tsx
import { NeonAuthUIProvider, AuthView } from '@neondatabase/neon-js/auth/react/ui';
import { client } from '@/lib/auth';

export default function AuthPage() {
  return (
    <NeonAuthUIProvider authClient={client.auth} theme="auto">
      <AuthView pathname="sign-in" />
    </NeonAuthUIProvider>
  );
}
\`\`\`

### Environment Variables (\`.env\`)

\`\`\`bash
# Neon Auth (managed by Neon, values from Neon Console > Auth settings)
VITE_NEON_AUTH_URL=https://ep-xxx.neonauth.us-east-2.aws.neon.tech/neondb/auth

# Neon Data API (enabled in Neon Console > Data API)
VITE_NEON_DATA_API_URL=https://ep-xxx.data.us-east-2.aws.neon.build
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
