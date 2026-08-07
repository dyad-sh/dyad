import { neon } from "@neondatabase/serverless";

// Server-side only: never import this module from a client component. Every
// query in the app goes through here, and every one of them carries its own
// authorization predicate — there is no client-side database access.
export const sql = neon(process.env.DATABASE_URL!);
