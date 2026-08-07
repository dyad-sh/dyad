/**
 * The pinned audit action vocabulary.
 *
 * Deliberately dependency-free: the audit filter UI is a client component, so
 * anything it imports is bundled for the browser. Keeping these constants out
 * of `lib/audit.ts` (which opens a database connection at module scope) is what
 * stops the audit page from evaluating the Postgres driver in the browser.
 */
export type AuditAction =
  | "org.created"
  | "org.updated"
  | "member.invited"
  | "invite.revoked"
  | "invite.accepted"
  | "member.role_changed"
  | "member.removed"
  | "project.created"
  | "project.updated"
  | "project.deleted"
  | "apikey.created"
  | "apikey.revoked";

export const AUDIT_ACTIONS: AuditAction[] = [
  "org.created",
  "org.updated",
  "member.invited",
  "invite.revoked",
  "invite.accepted",
  "member.role_changed",
  "member.removed",
  "project.created",
  "project.updated",
  "project.deleted",
  "apikey.created",
  "apikey.revoked",
];
