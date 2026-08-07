import { neon } from "@neondatabase/serverless";

// Server-side only: never import this module from a client component.
export const sql = neon(process.env.DATABASE_URL!);

/**
 * Postgres returns `bigint`/`numeric` aggregates as strings so no precision is
 * lost in transit. Money must reach JSON as a JavaScript integer, so every
 * aggregate read goes through here rather than through `Number()` scattered
 * around the call sites.
 */
export function toInt(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Math.trunc(value);
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
