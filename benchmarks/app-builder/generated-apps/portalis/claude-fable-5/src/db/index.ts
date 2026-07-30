import { neon } from "@neondatabase/serverless";

// Server-side only. Never import this in client components.
export const sql = neon(process.env.DATABASE_URL!);
