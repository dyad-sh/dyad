export type Role = "admin" | "agent" | "requester";

export const ROLES: Role[] = ["admin", "agent", "requester"];

export function isRole(value: unknown): value is Role {
  return value === "admin" || value === "agent" || value === "requester";
}

export function defaultRoleForEmail(email: string): Role {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.startsWith("admin+")) {
    return "admin";
  }
  return "requester";
}

export function homePathForRole(role: Role): string {
  if (role === "admin") return "/admin";
  if (role === "agent") return "/agent";
  return "/tickets";
}

export function canAccessAdmin(role: Role): boolean {
  return role === "admin";
}

export function canAccessAgent(role: Role): boolean {
  return role === "admin" || role === "agent";
}
