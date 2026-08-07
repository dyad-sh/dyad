import { neon } from "@neondatabase/serverless";

/**
 * Server-side only: never import this module from a client component. Every
 * query in the app funnels through here and through `src/lib/queries.ts`.
 */
export const sql = neon(process.env.DATABASE_URL!);

export * from "@/lib/types";
