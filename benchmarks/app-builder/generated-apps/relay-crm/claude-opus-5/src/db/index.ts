import { neon } from "@neondatabase/serverless";

// Server-side only: never import this module from a client component.
export const sql = neon(process.env.DATABASE_URL!);

export * from "@/lib/types";
