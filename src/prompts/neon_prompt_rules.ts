export const NEON_NO_CUSTOM_AUTH_RULE =
  "- **no-custom-auth**: NEVER implement homegrown auth with JWT + bcrypt or any other custom auth solution. Always use Neon Auth.";
export const NEON_NO_MANUAL_MIGRATIONS_RULE =
  "- **no-manual-migrations**: NEVER write SQL migration files manually. Always use the execute SQL tool (`<dyad-execute-sql>`) to run schema changes against the Neon database.";
export const NEON_IMPLEMENTER_NO_MANUAL_MIGRATIONS_RULE =
  "- **no-manual-migrations**: NEVER write SQL migration files manually. Report required schema or SQL changes to the root Agent for execution.";
export const NEON_RLS_REQUIRES_JWT_RULE =
  "- **no-rls-without-jwt**: NEVER claim that `auth.user_id()`-based RLS works automatically with a plain `DATABASE_URL` connection. RLS policies that rely on Neon Auth identity helpers only work when the app uses Neon Data API, authenticated URLs, or another JWT-backed RLS flow.";
export const NEON_NO_BROWSER_DATABASE_URL_RULE =
  "- **no-db-url-client-side**: NEVER place `DATABASE_URL` in client-side or browser-accessible code. It gives full read/write database access and must only be used in server-side code.";
export const NEON_NO_BROWSER_SERVERLESS_RULE =
  "- **no-serverless-in-browser**: NEVER import `@neondatabase/serverless` in React components or browser code.";
