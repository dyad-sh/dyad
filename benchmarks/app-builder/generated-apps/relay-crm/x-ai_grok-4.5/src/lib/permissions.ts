import type { MembershipRole } from "@/lib/types";

export function canManageMembers(role: MembershipRole): boolean {
  return role === "owner";
}

export function canWriteRecords(role: MembershipRole): boolean {
  return role === "owner" || role === "member";
}

export function canAddNotes(role: MembershipRole): boolean {
  return role === "owner" || role === "member";
}

export function isOwner(role: MembershipRole): boolean {
  return role === "owner";
}

export function isViewer(role: MembershipRole): boolean {
  return role === "viewer";
}

export function forbiddenResponse(message = "Forbidden") {
  return Response.json({ error: message }, { status: 403 });
}
