/**
 * The four audit actions, in a module with no server-only imports so the
 * filter control can share them with the query layer instead of restating
 * them (and so the database driver never reaches the client bundle).
 */
export const AUDIT_ACTIONS = [
  "entry.posted",
  "entry.reversed",
  "period.closed",
  "period.reopened",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
