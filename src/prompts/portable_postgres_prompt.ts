// Prompt for apps built on portable Postgres: a standard driver talking to a
// plain DATABASE_URL. The point is that the same code runs against the Neon
// development database and against a self-hosted production database (e.g. one
// Coolify provisions), so nothing vendor-specific may leak into the app.

export const PORTABLE_POSTGRES_NOT_AVAILABLE_SYSTEM_PROMPT = `
# Database (not connected)

This app is set up for portable Postgres, but no database is connected yet.
Tell the user to connect one in the Database section before building features
that need to store data.
`;

export function getPortablePostgresSystemPrompt(
  frameworkType: string | null,
): string {
  const isNextJs = frameworkType === "nextjs";
  return `
# Database: portable Postgres

This app talks to a plain PostgreSQL database through a standard driver and a
\`DATABASE_URL\` connection string. It is deliberately portable: the same code
must run unchanged against the managed development database and against a
self-hosted production database. Never introduce anything tied to one provider.

## Hard rules

- **no-vendor-packages**: NEVER install or import \`@neondatabase/serverless\`,
  \`@neondatabase/auth\`, \`@neondatabase/neon-js\`, \`@supabase/supabase-js\`, or
  any other provider-specific client. Use \`pg\` only.
- **no-vendor-auth**: NEVER use Neon Auth or Supabase Auth. This app has no
  hosted auth service.
- **no-vendor-rls**: NEVER write RLS policies that depend on provider identity
  helpers such as \`auth.user_id()\`. They do not exist on a plain Postgres.
- **no-db-url-client-side**: NEVER read \`DATABASE_URL\` from, or import the
  database module into, browser code. It grants full read/write access to the
  database. All queries run on the server.
- **no-orm-swap**: If the app already uses a query builder or ORM, keep using
  it. Do not replace it with raw SQL, or raw SQL with an ORM.
- **no-db-at-module-scope**: NEVER open a connection, or throw for a missing
  \`DATABASE_URL\`, while a module is being loaded. Builds evaluate server
  modules, so doing either makes the app fail to build rather than fail to
  serve. Connect on first use instead.

## Connecting

Put the connection in a single server-only module and import it everywhere
else. Reuse one pool across requests; do not open a client per request.

Create that pool **lazily**, on first use. Building evaluates server modules to
analyse routes, so a pool created — or a missing \`DATABASE_URL\` thrown on — at
module scope makes the app fail to build rather than fail to serve.

\`\`\`ts
${isNextJs ? "// app/lib/db.ts (server-only)" : "// server/db.ts (server-only)"}
import { Pool } from "pg";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    // Managed Postgres usually requires TLS and puts sslmode in the URL, while
    // a self-hosted database often has none. Deciding from the URL keeps one
    // code path working in both places.
    const sslmode = new URL(connectionString).searchParams.get("sslmode");
    const needsSsl = sslmode !== null && sslmode !== "disable";
    pool = new Pool({
      connectionString,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}
\`\`\`

## Querying

Always use parameterised queries. Never build SQL by concatenating user input.

\`\`\`ts
const { rows } = await getPool().query(
  "SELECT id, title, done FROM todos ORDER BY id DESC",
);

const { rows: inserted } = await getPool().query(
  "INSERT INTO todos (title) VALUES ($1) RETURNING id, title, done",
  [title],
);
\`\`\`

## Where server code lives

${
  isNextJs
    ? `- Route handlers under \`app/api/**/route.ts\`, or Server Actions, or Server
  Components. \`DATABASE_URL\` and the db module must stay out of any file that
  runs in the browser (anything with \`"use client"\`).
- The app must listen on the port the platform provides. Keep the standard
  \`next start\` behaviour; do not hardcode a different port.`
    : `- Server-side route handlers only. \`DATABASE_URL\` and the db module must
  stay out of \`src/\` client code.
- The server must listen on \`process.env.PORT\` with a fallback to 3000, and
  bind to \`0.0.0.0\` so it is reachable when deployed.`
}

## Schema changes

Change the schema by running SQL against the connected development database
with the \`<dyad-execute-sql>\` tag, exactly as you would for any Postgres.
Write plain, standard DDL — no provider-specific extensions or helpers — so the
same statements apply cleanly to the production database later.

Prefer additive changes. If a change would drop a column or table, say so
plainly before doing it.

## Dependencies

If \`pg\` is not already in \`package.json\`, add it before writing code that
imports it.
`;
}
