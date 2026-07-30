export type Role = "admin" | "agent" | "requester";

export const ROLES: Role[] = ["admin", "agent", "requester"];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as string[]).includes(value);
}

export function dashboardPathFor(role: Role): string {
  if (role === "admin") return "/admin";
  if (role === "agent") return "/agent";
  return "/tickets";
}

export const roleBadgeClasses: Record<Role, string> = {
  admin: "bg-violet-50 text-violet-700 border-violet-200",
  agent: "bg-sky-50 text-sky-700 border-sky-200",
  requester: "bg-slate-100 text-slate-700 border-slate-200",
};

/** Default role for a brand-new user (local-dev bootstrap rule). */
export function defaultRoleForEmail(email: string): Role {
  const localPart = email.split("@")[0]?.toLowerCase() ?? "";
  return localPart.startsWith("admin+") ? "admin" : "requester";
}
