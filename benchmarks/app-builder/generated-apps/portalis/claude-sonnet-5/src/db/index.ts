import { neon } from "@neondatabase/serverless";

export const sql = neon(process.env.DATABASE_URL!);

// IMPORTANT: Only use this in server-side code (API routes, server actions, server components).
// NEVER import @neondatabase/serverless in client-side React components.
