export const WORKSPACE_ROLES = ["owner", "member", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

/** Members and owners can create/edit/delete workspace data; viewers cannot. */
export function canWrite(role: string | null): boolean {
  return role === "owner" || role === "member";
}

/** Only owners can manage members, roles and invites. */
export function canManageMembers(role: string | null): boolean {
  return role === "owner";
}

export const INVITABLE_ROLES = ["member", "viewer"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(value: unknown): value is InvitableRole {
  return typeof value === "string" && (INVITABLE_ROLES as readonly string[]).includes(value);
}
