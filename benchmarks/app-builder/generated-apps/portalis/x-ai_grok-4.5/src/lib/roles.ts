export type OrgRole = "org_admin" | "org_member";

export function isOrgRole(value: unknown): value is OrgRole {
  return value === "org_admin" || value === "org_member";
}

export function isOrgAdmin(role: OrgRole): boolean {
  return role === "org_admin";
}
