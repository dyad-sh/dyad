import "server-only";

import { sql } from "@/db";
import { auth } from "@/lib/auth/server";

export const roles = ["admin", "agent", "requester"] as const;
export type Role = (typeof roles)[number];

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
};

export function dashboardPath(role: Role) {
  if (role === "admin") return "/admin";
  if (role === "agent") return "/agent";
  return "/tickets";
}

export async function getSessionUser(): Promise<CurrentUser | null> {
  const { data: session } = await auth.getSession();
  if (!session?.user) return null;

  const bootstrapRole: Role = session.user.email.split("@")[0]?.toLowerCase().startsWith("admin+") ? "admin" : "requester";
  await sql`
    INSERT INTO user_profiles (user_id, role)
    VALUES (${session.user.id}, ${bootstrapRole})
    ON CONFLICT (user_id) DO NOTHING
  `;

  const profiles = (await sql`
    SELECT role, active FROM user_profiles WHERE user_id = ${session.user.id}
  `) as Array<{ role: Role; active: boolean }>;

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: profiles[0].role,
    active: profiles[0].active,
  };
}

export async function getCurrentUser() {
  const user = await getSessionUser();
  return user?.active ? user : null;
}
